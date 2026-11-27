import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export function GET() {
  return NextResponse.json({ captchaSiteKey: process.env.MCPOS_TURNSTILE_SITE_KEY || null }, { headers: { "Cache-Control": "no-store" } });
}
