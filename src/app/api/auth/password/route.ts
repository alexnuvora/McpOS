import { NextRequest, NextResponse } from "next/server";
import { mcposAppOrigin } from "@/lib/app-origin";
import { createServerSupabaseClient, isMcpOSAccountAllowed } from "@/lib/supabase/server";
import * as z from "zod/v4";
import { readBoundedBody } from "@/lib/bounded-request";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  try {
    const origin = mcposAppOrigin();
    if (!origin || request.headers.get("origin") !== origin) return NextResponse.json({ error: "Origin not allowed." }, { status: 403, headers });
    const client = await createServerSupabaseClient();
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user?.email_confirmed_at || !isMcpOSAccountAllowed(user)) return NextResponse.json({ error: "Sign in using your recovery link first." }, { status: 401, headers });
    const raw = await readBoundedBody(request, 4096);
    if (raw === null) return NextResponse.json({ error: "Request too large or invalid." }, { status: 413, headers });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { body = null; }
    const parsed = z.object({ password: z.string().min(12).max(72) }).safeParse(body);
    if (!parsed.success || Buffer.byteLength(parsed.data.password,"utf8") > 72) return NextResponse.json({ error: "Choose a password of at least 12 characters and no more than 72 UTF-8 bytes." }, { status: 400, headers });
    const result = await client.auth.updateUser({ password: parsed.data.password });
    if (result.error) return NextResponse.json({ error: "Unable to set password. Request a fresh recovery link or choose a stronger password." }, { status: 400, headers });
    await client.auth.signOut({ scope: "global" });
    return NextResponse.json({ ok: true }, { headers });
  } catch { return NextResponse.json({ error: "Password service unavailable." }, { status: 503, headers }); }
}
