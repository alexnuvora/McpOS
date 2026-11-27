import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, isMcpOSAccountAllowed } from "@/lib/supabase/server";

const supabaseUrl = () => (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const serviceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY;

type DeviceAccount = { userId: string; email: string };
type AccountResult = { account: DeviceAccount } | { response: NextResponse };

async function rest(path: string, init: RequestInit = {}) {
  const url = supabaseUrl();
  const key = serviceKey();
  if (!url || !key) throw new Error("McpOS device service is not configured.");
  return fetch(url + "/rest/v1/" + path, {
    ...init,
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
}

export async function getDeviceAccount(_request: NextRequest): Promise<AccountResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user || !isMcpOSAccountAllowed(user)) {
      return { response: NextResponse.json({ error: "Sign in with an authorised McpOS email address first." }, { status: 401 }) };
    }
    return { account: { userId: user.id, email: user.email! } };
  } catch (error) {
    console.error("McpOS session verification failed:", error);
    return { response: NextResponse.json({ error: "McpOS authentication service is not configured." }, { status: 503 }) };
  }
}

export async function supabaseRest(path: string, init: RequestInit = {}) {
  return rest(path, init);
}

export function newPairingCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  return Array.from(bytes, byte => alphabet[byte & 31]).join("");
}
