const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
function getServiceKey(): string | null {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default ?? null; } catch { return null; }
}
Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const upgrade = request.method === "GET" && request.headers.get("upgrade")?.toLowerCase() === "websocket";
  if (!upgrade && request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const bearer = (request.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer || bearer.length < 40 || bearer.length > 256) return reply({ error: "Unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const key = getServiceKey();
  if (!url || !key) return reply({ error: "Device relay is not configured." }, 503);
  const tokenHash = await sha256(bearer);
  const headers = { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
  const claim = () => fetch(url + "/rest/v1/rpc/claim_mcpos_device_command", {
    method: "POST", headers, body: JSON.stringify({ p_token_hash: tokenHash }),
  });
  async function compatibleCommand(response: Response) {
    const command = await response.json();
    if (command?.payload?.minRelay === 4 && request.headers.get("x-mcpos-relay-version") !== "4") {
      const failed = await fetch(url + "/rest/v1/rpc/complete_mcpos_device_command", {
        method:"POST", headers, body:JSON.stringify({p_token_hash:tokenHash,p_command_id:command.id,p_result:{},p_error_message:"Desktop update required."}),
      });
      if (!failed.ok) throw new Error("Could not close incompatible command.");
      return null;
    }
    return command;
  }
  if (upgrade) {
    const credential = await fetch(url + "/rest/v1/mcpos_device_credentials?select=id&revoked_at=is.null&token_hash=eq." + tokenHash + "&limit=1", { headers });
    if (!credential.ok || !(await credential.json()).length) return reply({ error: "Invalid device credential" }, 401);
    const { socket, response } = Deno.upgradeWebSocket(request);
    let busy = false;
    socket.onmessage = async event => {
      if (event.data !== "claim" || busy) { socket.close(1008, "Invalid request"); return; }
      busy = true;
      try {
        const result = await claim();
        if (!result.ok) { socket.close(1008, "Claim unavailable"); return; }
        socket.send(JSON.stringify({ command: await compatibleCommand(result) }));
      } catch {
        if (socket.readyState === WebSocket.OPEN) socket.close(1011, "Relay unavailable");
      } finally { busy = false; }
    };
    return response;
  }
  const body = await request.json().catch(() => ({}));
  if (typeof body?.authorize_command_id === "string") {
    const authorization = await fetch(url + "/rest/v1/rpc/authorize_mcpos_device_command", {
      method: "POST", headers, body: JSON.stringify({ p_token_hash: tokenHash, p_command_id: body.authorize_command_id }),
    });
    if (!authorization.ok) {
      const details = await authorization.text();
      if (details.includes("invalid_device_credential")) return reply({ error: "Device credential revoked or unknown." }, 401);
      console.error("Device command authorization failed:", authorization.status, details.slice(0, 300));
      return reply({ error: "Could not authorize the pending desktop action." }, 503);
    }
    return reply({ authorized: (await authorization.json()) === true });
  }
  const response = await claim();
  if (!response.ok) {
    const details = await response.text();
    if (details.includes("invalid_device_credential")) return reply({ error: "Device credential revoked or unknown." }, 401);
    console.error("Device relay claim failed:", response.status, details.slice(0, 300));
    return reply({ error: "Could not poll the device command queue." }, 503);
  }
  const command = await compatibleCommand(response);
  return reply({ command: command ?? null });
});
