import { NextRequest, NextResponse } from "next/server";
import * as z from "zod/v4";
import { createServerSupabaseClient, isAllowedMcpOSEmail, publicRegistrationEnabled } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const schema = z.object({ email: z.string().trim().email().max(254), next: z.string().max(4096).optional(), captchaToken: z.string().max(4096).optional() });

export function GET() {
  return NextResponse.json({ publicRegistration: publicRegistrationEnabled(), captchaSiteKey: process.env.MCPOS_TURNSTILE_SITE_KEY || null }, { headers });
}

export async function POST(request: NextRequest) {
  try {
    const origin = new URL(process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin).origin;
    if (request.headers.get("origin") !== origin) return NextResponse.json({ error: "Origin not allowed." }, { status: 403, headers });
    const input = schema.safeParse(await request.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400, headers });
    const email = input.data.email.toLowerCase();
    if (process.env.MCPOS_TURNSTILE_SITE_KEY && !input.data.captchaToken) return NextResponse.json({ error: "Complete the security check." }, { status: 400, headers });
    // Same response for non-allowlisted addresses to avoid disclosing private membership.
    if (!publicRegistrationEnabled() && !isAllowedMcpOSEmail(email)) return NextResponse.json({ ok: true }, { headers });
    let next = "/";
    const requested = input.data.next || "/";
    if (requested.startsWith("/") && !requested.startsWith("//") && !requested.includes("\\")) {
      const target = new URL(requested, origin);
      if (target.origin === origin) next = target.pathname + target.search + target.hash;
    }
    const callback = new URL("/auth/callback", origin);
    callback.searchParams.set("next", next);
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: callback.href, captchaToken: input.data.captchaToken } });
    if (error) {
      if (error.status === 429) return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429, headers });
      return NextResponse.json({ error: "Unable to send the sign-in link. Check your email and complete the security check again." }, { status: 400, headers });
    }
    return NextResponse.json({ ok: true }, { headers });
  } catch { return NextResponse.json({ error: "Sign-in service unavailable." }, { status: 503, headers }); }
}
