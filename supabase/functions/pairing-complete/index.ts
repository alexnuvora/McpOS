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
  let body: { code?: unknown };
  try { body = await request.json(); } catch { return reply({ error: "Invalid JSON body" }, 400); }
  const code = typeof body.code === "string" ? body.code.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
  if (!/^[A-HJ-NP-Z2-9]{10}$/.test(code)) return reply({ error: "Enter a valid 10-character pairing code." }, 400);
  const url = Deno.env.get("SUPABASE_URL");
  const key = getServiceKey();
  if (!url || !key) return reply({ error: "Pairing service is not configured." }, 503);
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const [codeHash, tokenHash] = await Promise.all([sha256(code), sha256(token)]);
  const response = await fetch(url + "/rest/v1/rpc/complete_mcpos_pairing", {
    method: "POST",
    headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ p_code_hash: codeHash, p_token_hash: tokenHash }),
  });
  if (!response.ok) {
    const details = await response.text();
    if (details.includes("invalid_or_expired_pairing_code")) return reply({ error: "That pairing code is invalid, expired or already used. Generate a new code." }, 400);
    console.error("Pairing completion failed:", response.status, details.slice(0, 300));
    return reply({ error: "Could not complete pairing. Please try again." }, 500);
  }
  const result = await response.json();
  return reply({ token, device_id: result.device_id, device_name: result.device_name, relay_url: Deno.env.get("MCPOS_RELAY_URL") ?? null });
});
