import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, isMcpOSAccountAllowed } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const requestedNext = request.nextUrl.searchParams.get("next") || "/";
  const origin = request.nextUrl.origin;
  let next = "/";
  try {
    const target = new URL(requestedNext, origin);
    if (requestedNext.startsWith("/") && !requestedNext.startsWith("//") && !requestedNext.includes("\\") && target.origin === origin) next = target.pathname + target.search + target.hash;
  } catch { /* Fall back to the dashboard. */ }
  const loginUrl = new URL("/login", request.url);

  if (!code) {
    loginUrl.searchParams.set("error", "callback");
    return NextResponse.redirect(loginUrl);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    loginUrl.searchParams.set("error", "callback");
    return NextResponse.redirect(loginUrl);
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isMcpOSAccountAllowed(user)) {
    await supabase.auth.signOut();
    loginUrl.searchParams.set("error", "not-authorized");
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.redirect(new URL(next, request.url));
}
