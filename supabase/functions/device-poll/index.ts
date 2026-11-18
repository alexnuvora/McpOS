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
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const bearer = (request.headers.get("Authorization") ?? "").match(/^Bearer\\s+(.+)$/i)?.[1];
  if (!bearer || bearer.length < 40 || bearer.length > 256) return reply({ error: "Unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const key = getServiceKey();
  if (!url || !key) return reply({ error: "Device relay is not configured." }, 503);
  const tokenHash = await sha256(bearer);
  const headers = { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
  const response = await fetch(url + "/rest/v1/rpc/claim_mcpos_device_command", {
    method: "POST", headers, body: JSON.stringify({ p_token_hash: tokenHash }),
  });
  if (!response.ok) {
    const details = await response.text();
    if (details.includes("invalid_device_credential")) return reply({ error: "Device credential revoked or unknown." }, 401);
    console.error("Device relay claim failed:", response.status, details.slice(0, 300));
    return reply({ error: "Could not poll the device command queue." }, 503);
  }
  const command = await response.json();
  return reply({ command: command ?? null });
});
