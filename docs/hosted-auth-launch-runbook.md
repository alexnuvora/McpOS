# Hosted authentication launch runbook

Status on 2026-11-27: hosted auth verification observed CAPTCHA disabled, six-character provider password minimum, two authentication emails per hour, confirmation required, direct provider sign-up enabled and anonymous sign-in disabled. McpOS public onboarding remains disabled. This document is a rollout plan, not a claim that these settings have changed.

## Prerequisites (owner-controlled)
- While the two deployments share one Auth project, use one Cloudflare Turnstile widget explicitly authorised for mcpos-dashboard.netlify.app and deploy-preview-12--mcpos-dashboard.netlify.app. Use separate widgets only after separating the Auth projects.
- Configure a verified sending domain and dedicated transactional SMTP credentials. Supabase's built-in mail service is development-only; confirm sender identity, delivery, capacity and abuse limits before enabling signup.
- Set MCPOS_TURNSTILE_SITE_KEY through Netlify's environment settings for the corresponding deployment contexts. The site key is public; the secret key belongs only in the Supabase Auth provider settings, never in Git, logs, or the frontend.
- Both deployments currently share hosted Auth. Stage and verify a compatible login build on both origins before enabling provider-wide CAPTCHA, or create a separate staging Auth project. A single shared Auth provider must accept the widget tokens from both origins; do not assume separate widget secrets will work against one provider. Prefer a single production widget with explicitly authorised hostnames while the shared project is retained.

## Staged configuration (2026-11-27)
- Cloudflare managed widget "McpOS Authentication" created with both exact hostnames and no clearance cookie.
- Netlify MCPOS_TURNSTILE_SITE_KEY configured for deploy previews only. A fresh preview build is required to verify frontend rendering.
- Production key configuration and a compatible production login build are still required before enabling CAPTCHA on the shared Supabase Auth project.
- Provider CAPTCHA remains disabled until the owner completes the coordinated activation and tests. Do not mark CAPTCHA verified on the basis of frontend rendering.

## Controlled rollout
1. Verify current beta login and recovery; retain an authenticated owner session.
2. Set hosted password minimum to 12 characters (matching app registration/reset). Keep email confirmation and anonymous-sign-in restrictions enabled.
3. Enable custom SMTP; review email and OTP rates for expected volume. Avoid bulk production probes.
4. Verify site key reaches the login page, then enable Turnstile through Supabase Auth protection with the matching secret. Coordinate deployment and provider activation to avoid lockout.
5. On a dedicated staging project, test direct Auth endpoints rejecting missing, invalid and replayed CAPTCHA tokens; verify valid user-driven login, signup, magic link and recovery. Validate rate limiting without targeting real customer accounts. Repeat a controlled smoke test on the hosted origin after configuration.
6. Confirm the existing owner and paired device remain accessible, and non-allowlisted accounts cannot reach McpOS until authorised.
7. Keep MCPOS_AUTH_CAPTCHA_VERIFIED unset until evidence is recorded. Do not enable MCPOS_PUBLIC_REGISTRATION, subscription enforcement or live billing solely because the CAPTCHA tests pass.

## References
- https://supabase.com/docs/guides/auth/auth-captcha
- https://supabase.com/docs/guides/auth/rate-limits
- https://supabase.com/docs/guides/auth/auth-smtp
- https://developers.cloudflare.com/turnstile/get-started/widget-management/dashboard/

No secret values or customer records are required in this document.
