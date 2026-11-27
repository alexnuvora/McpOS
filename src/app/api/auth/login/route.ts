import { mcposAppOrigin } from "@/lib/app-origin";
import { readOAuthBody } from "@/lib/mcp-oauth";
import { NextRequest, NextResponse } from "next/server";
import * as z from "zod/v4";
import { createServerSupabaseClient, isAllowedMcpOSEmail, isMcpOSAccountAllowed, publicRegistrationEnabled } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const schema = z.object({
  action: z.enum(["password","register","magic","recovery","recovery-code"]).default("magic"),
  email: z.string().trim().email().max(254),
  password: z.string().max(1024).optional(),
  recoveryCode: z.string().regex(/^\d{6,10}$/).optional(),
  next: z.string().max(4096).optional(),
  captchaToken: z.string().max(4096).optional(),
});

export function GET() {
  return NextResponse.json({ publicRegistration: publicRegistrationEnabled(), captchaSiteKey: process.env.MCPOS_TURNSTILE_SITE_KEY || null }, { headers });
}

export async function POST(request: NextRequest) {
  try {
    const origin = mcposAppOrigin();
    if (!origin) return NextResponse.json({ error: "Sign-in service unavailable." }, { status: 503, headers });
    if (request.headers.get("origin") !== origin) return NextResponse.json({ error: "Origin not allowed." }, { status: 403, headers });
    const raw = await readOAuthBody(request, 16384);
    if (raw === null) return NextResponse.json({ error: "Request too large or invalid." }, { status: 413, headers });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Check your email and form details." }, { status: 400, headers }); }
    const input = schema.safeParse(body);
    if (!input.success) return NextResponse.json({ error: "Check your email and form details." }, { status: 400, headers });
    const { action, password, captchaToken, recoveryCode } = input.data;
    const email = input.data.email.toLowerCase();
    const loginFailure = () => NextResponse.json({ error: "Unable to sign in. Check your credentials or verify your email." }, { status: 401, headers });
    const recoveryFailure = () => NextResponse.json({ error: "Invalid or expired recovery code. Request a new email if needed." }, { status: 401, headers });
    const genericSuccess = () => NextResponse.json({ ok: true }, { headers });
    if (process.env.MCPOS_TURNSTILE_SITE_KEY && !captchaToken) return NextResponse.json({ error: "Complete the security check." }, { status: 400, headers });
    if (action === "password" && !password) return loginFailure();
    if (action === "register" && (!password || password.length < 12 || Buffer.byteLength(password,"utf8") > 72)) {
      return NextResponse.json({ error: "Choose a password of at least 12 characters and no more than 72 UTF-8 bytes." }, { status: 400, headers });
    }
    // No account membership or existence disclosure to unauthorised callers.
    if (!publicRegistrationEnabled() && !isAllowedMcpOSEmail(email)) return action === "password" ? loginFailure() : action === "recovery-code" ? recoveryFailure() : genericSuccess();
    let next = "/";
    const requested = input.data.next || "/";
    if (requested.startsWith("/") && !requested.startsWith("//") && !requested.includes("\\")) {
      const target = new URL(requested, origin);
      if (target.origin === origin) next = target.pathname + target.search + target.hash;
    }
    const callback = new URL(action === "recovery" ? "/auth/recovery" : "/auth/callback", origin);
    if (action !== "recovery") callback.searchParams.set("next", next);
    const supabase = await createServerSupabaseClient();
    if (action === "recovery-code") {
      if (!recoveryCode) return recoveryFailure();
      const { data, error } = await supabase.auth.verifyOtp({ email, token: recoveryCode, type: "recovery", options: { captchaToken } });
      if (error?.status === 429) return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429, headers });
      if (error || !data.user || !data.session || !isMcpOSAccountAllowed(data.user)) {
        if (data.session) await supabase.auth.signOut({ scope: "local" });
        return recoveryFailure();
      }
      return NextResponse.json({ ok: true, next: "/reset-password" }, { headers });
    }
    if (action === "password") {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password: password!, options: { captchaToken } });
      if (error?.status === 429) return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429, headers });
      if (error || !data.user || !data.session || !data.user.email_confirmed_at || !isMcpOSAccountAllowed(data.user)) {
        if (data.session) await supabase.auth.signOut({ scope: "local" });
        return loginFailure();
      }
      return NextResponse.json({ ok: true, next }, { headers });
    }
    if (action === "register") {
      const { data, error } = await supabase.auth.signUp({ email, password: password!, options: { emailRedirectTo: callback.href, captchaToken } });
      if (data.session) await supabase.auth.signOut({ scope: "local" });
      if (error?.status === 429) return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429, headers });
      // Keep duplicate/unknown-account responses generic. Do not auto-sign-in new registrations.
      return genericSuccess();
    }
    const { error } = action === "recovery"
      ? await supabase.auth.resetPasswordForEmail(email, { redirectTo: callback.href, captchaToken })
      : await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: callback.href, captchaToken } });
    if (error?.status === 429) return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429, headers });
    return genericSuccess();
  } catch { return NextResponse.json({ error: "Sign-in service unavailable." }, { status: 503, headers }); }
}
