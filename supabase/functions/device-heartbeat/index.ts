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
  const bearer = (request.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer || bearer.length < 40) return reply({ error: "Unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const key = getServiceKey();
  if (!url || !key) return reply({ error: "Heartbeat service is not configured." }, 503);
  const tokenHash = await sha256(bearer);
  const headers = { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
  const lookup = await fetch(url + "/rest/v1/mcpos_device_credentials?select=id,device_id,revoked_at&token_hash=eq." + tokenHash + "&limit=1", { headers });
  if (!lookup.ok) return reply({ error: "Unable to verify device." }, 503);
  const credential = (await lookup.json())[0];
  if (!credential || credential.revoked_at) return reply({ error: "Device credential revoked or unknown." }, 401);
  const deviceLookup = await fetch(url + "/rest/v1/mcpos_devices?select=id,status&id=eq." + credential.device_id + "&limit=1", { headers });
  if (!deviceLookup.ok) return reply({ error: "Unable to verify device status." }, 503);
  const deviceRows = await deviceLookup.json();
  if (!deviceRows[0] || deviceRows[0].status === "revoked") return reply({ error: "Device has been revoked." }, 401);
  const now = new Date().toISOString();
  const [deviceUpdate, credentialUpdate] = await Promise.all([
    fetch(url + "/rest/v1/mcpos_devices?id=eq." + credential.device_id + "&status=neq.revoked", {
      method: "PATCH", headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ status: "online", last_seen_at: now }),
    }),
    fetch(url + "/rest/v1/mcpos_device_credentials?id=eq." + credential.id + "&revoked_at=is.null", {
      method: "PATCH", headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ last_used_at: now }),
    }),
  ]);
  if (!deviceUpdate.ok || !credentialUpdate.ok) return reply({ error: "Could not update device heartbeat." }, 503);
  return reply({ ok: true, device_id: credential.device_id, last_seen_at: now });
});
