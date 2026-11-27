import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createServerSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase URL and publishable key are not configured.");
  }

  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const cookie of cookiesToSet) {
            cookieStore.set(cookie.name, cookie.value, cookie.options);
          }
        } catch {
          // Server components cannot write cookies; route handlers can.
        }
      },
    },
  });
}

export function isAllowedMcpOSEmail(email: string | null | undefined) {
  if (!email) return false;
  const allowed = (process.env.MCPOS_ALLOWED_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}

/** This compatibility release never enables public registration. */
export function publicRegistrationEnabled() { return false; }

export function isMcpOSAccountAllowed(user: { email?: string | null; email_confirmed_at?: string | null; is_anonymous?: boolean; banned_until?: string | null }) {
  if (!user.email || !user.email_confirmed_at || user.is_anonymous || (user.banned_until && Date.parse(user.banned_until) > Date.now())) return false;
  return isAllowedMcpOSEmail(user.email) || publicRegistrationEnabled();
}
