# McpOS commercial launch gate — owner review required

McpOS is operated under VORLEN LTD (company number 17387520). This is an internal launch checklist, not published legal advice or a representation that the service is commercially available.

## Legal and privacy approval
- Verify registered office, jurisdiction of registration, support and privacy contact channels, trading details and VAT treatment before publishing.
- Review UK GDPR transparency requirements: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-be-informed/
- Review UK distance selling requirements: https://www.gov.uk/online-and-distance-selling-for-businesses
- Check which consumer subscription regulations are in force on the actual launch date, including the DMCCA subscription provisions. Do not assume every provision is already commenced.
- Confirm consumer vs business contract classifications, cooling-off/cancellation and refund handling, accessible cancellation route, renewal information, contract confirmation on a durable medium, and payment obligation disclosure.
- Approve versioned terms and privacy notices; document acceptance before a real contract is created. Do not treat a sandbox Checkout as a paid contract.
- Complete data mapping, retention schedule, deletion/export procedures, processor contracts, international transfer assessment and incident response. Screen captures and approved file contents may contain sensitive or third-party information. Assess whether a DPIA is required before public release.

## Required technical gates
- Deploy only validated migrations via the existing main-branch GitHub workflow. Keep sandbox flags disabled initially.
- Configure Stripe test keys and webhook secret through hosting secrets; verify signed subscription events, duplicate delivery and out-of-order events. Never put keys in Git.
- Verify test checkout, cancellation, failed payment, expiry, portal and retry flows using dedicated test accounts; confirm no live transactions.
- Verify Supabase Auth CAPTCHA and rate limits directly against Auth API, not only the frontend; test magic-link PKCE on the actual deployed origin.
- Confirm anonymous users are rejected and owner access preserved. Review static token expiry, resource bindings and OAuth client registration abuse controls.
- Test account isolation, quotas, simultaneous checkouts, device revocation and grant expiry using two accounts.
- Verify the Windows installer signature and publisher; validate local permission switches, stop controls and browser network isolation.
- Exercise ChatGPT and Claude separately with the intended distribution method; confirm current platform policies for paid external functionality.
- Confirm monitoring and incident response, backup/restore, rate limiting, support contact and refund handling.
- Keep public registration off until every required gate is evidenced. No live billing until a distinct production rollout and owner approval.
