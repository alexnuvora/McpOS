import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, isAllowedMcpOSEmail } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const requestedNext = request.nextUrl.searchParams.get("next") || "/";
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/";
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
  if (!user || !isAllowedMcpOSEmail(user.email)) {
    await supabase.auth.signOut();
    loginUrl.searchParams.set("error", "not-authorized");
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.redirect(new URL(next, request.url));
}
