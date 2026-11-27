import { NextRequest, NextResponse } from "next/server";
import { mcposAppOrigin } from "@/lib/app-origin";
import { createServerSupabaseClient, isMcpOSAccountAllowed } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const origin = mcposAppOrigin();
  if (!origin) return NextResponse.json({ error: "Recovery service unavailable." }, { status: 503 });
  const failure = new URL("/login?error=recovery", origin);
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(failure);
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(failure);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email_confirmed_at || !isMcpOSAccountAllowed(user)) {
    await supabase.auth.signOut({ scope: "local" });
    return NextResponse.redirect(failure);
  }
  return NextResponse.redirect(new URL("/reset-password", origin));
}
