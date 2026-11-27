# Hosted authentication launch runbook

## Verified closed-beta evidence — 2026-11-27

- Production Vercel site URL and exact callback/recovery redirects, email confirmation, anonymous sign-in disabled, and provider minimum password length of 12 verified: https://github.com/alexnuvora/McpOS/actions/runs/46080439191
- Existing Cloudflare managed widget "McpOS Authentication" authorizes Vercel and Netlify production hostnames and two explicit Netlify preview hostnames. Matching site key configured on both platforms; provider Turnstile enabled by owner.
- Hosted Auth rejects missing and invalid CAPTCHA tokens using two synthetic password grant requests (no account creation or email sends): https://github.com/alexnuvora/McpOS/actions/runs/46081541466
- Owner completed password login in the McpOS isolated browser after CAPTCHA activation. Authenticated dashboard and paired Windows device observed via McpOS snapshot.
- Owner reports successful password recovery; recorded as owner-tested, not an independently observed reset transaction.
- Owner elected to retain Supabase's built-in email provider, with no custom SMTP. Closed-beta email is retained. Default-provider restrictions mean public registration/recovery delivery remains a separate launch blocker; verify a supported delivery arrangement before opening public registration.
- Public registration, paid entitlement enforcement and live billing remain disabled. No credentials or personal information recorded here.

## Remaining gates

1. Verify valid signup, email confirmation, magic link and recovery with an independent dedicated test account; prove public customer email delivery, recovery capacity and rate limits. No bulk production probes.
2. Test replayed CAPTCHA tokens and account isolation using a dedicated staging environment; maintain explicit authorized hostnames while sharing the Auth project.
3. Verify both hosted origins render and accept the same Turnstile widget; retain an authenticated owner session during future provider changes.
4. Keep MCPOS_AUTH_CAPTCHA_VERIFIED unset until all required launch evidence is recorded. Do not enable public registration, subscription enforcement or live billing solely because beta login passed.

## Configuration safeguards

- The Turnstile site key is public; the matching secret belongs only in Supabase Auth provider settings, never Git, logs or frontend.
- Do not change provider email templates without confirming the chosen email delivery arrangement supports customization.
- Use the project-pinned main-only hosted-auth baseline and preflight workflows to check nonsecret configuration and bounded synthetic CAPTCHA rejection.

## References

- https://supabase.com/docs/guides/auth/auth-captcha
- https://supabase.com/docs/guides/auth/rate-limits
- https://supabase.com/docs/guides/auth/auth-smtp
- https://developers.cloudflare.com/turnstile/get-started/widget-management/dashboard/
