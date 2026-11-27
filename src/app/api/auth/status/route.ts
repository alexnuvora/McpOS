import { NextResponse } from "next/server";
import { createServerSupabaseClient, isMcpOSAccountAllowed } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  const authenticated = !error && Boolean(user && isMcpOSAccountAllowed(user));
  return NextResponse.json({
    authenticated,
    user: authenticated && user ? { email: user.email } : null,
  }, { headers: { "Cache-Control": "no-store" } });
}
