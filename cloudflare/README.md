# Selection Studio Cloudflare production foundation (ZH-64 .. ZH-68)

## What is provisioned (Zh2 account)

- Zero Trust organization: `Selection Studio Zh2`, auth domain `blue-shadow-a981.cloudflareaccess.com`.
- OTP email identity provider: `d9fd3d2d-3e9c-4fa4-a5a7-21c7e1849d7d`.
- Self-hosted Access application `Selection Studio Operators`, domain `selection-studio-e1c.pages.dev`, app id `25b8d99f-32c8-4bf5-b7de-2ea399eda4ab`, audience `b8242a004bf471634c5245dc720d3e9395e2d748d04ce8438d26038e458895ad`.
- Access policy `Owner operator` allows only the linked Zh2 operator email. Never replace with an Everyone or Bypass policy.
- Cloudflare Pages project `selection-studio` configured with `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` and `OPERATOR_EMAILS` as environment variables for production and preview.
- D1 database `selection-studio-security`, id `ae03b8c4-2b05-4f3e-9d3d-151ae77c0dbc`, bound as `SECURITY_DB` in both environments. Schema in `cloudflare/schema-security.sql` was applied via Cloudflare D1 API. D1 records contain pseudonymous actor hashes, quotas and event status; no question images or raw text.

**Deployment state**: Configured resources exist, but PR #45 remains unmerged and the new Worker/UI must still be deployed and browser-tested. Existing production Pages artifact is unchanged.

## Routing and policy

- GitHub Actions builds the same native Pages asset tree for `/`, `/studio/`, `/admin/`. Worker serves native `env.ASSETS` (no GitHub Pages proxy).
- `GET /health`: operational routing status.
- `GET /api/session`: validates Cloudflare Access JWT signature, issuer, audience, expiry, and operator email allowlist.
- `POST /api/ocr`: only for verified session, JSON, up to 8 MiB. Uses D1 quota windows (10/minute, 100/day per actor) and an audit log; **missing binding, audit failure or upstream token => fail closed**. Upstream token never reaches client JavaScript.
- Operator and admin UI use verified /api/session. OCR console uses same-origin /api/ocr. Client-side login state alone does not authorize access.

## Outstanding production blockers

1. **OCR upstream secret**: Upstream `examforge-free-ocr` currently contains an existing encrypted secret named `ACCESS_TOKEN`. Its value cannot be read from Cloudflare by design. Do not rotate it silently: that can break other clients. A coordinated rotation or separately provisioned credential is needed before `OCR_SERVICE_TOKEN` is set on Pages.
2. **Upstream direct access**: Verify the OCR Worker strictly enforces its own bearer token; otherwise a direct URL could bypass the gateway.
3. Test the OTP flow in a real authenticated browser, and check whether preview branch hostnames receive equivalent Access protection.
4. Run the full existing CI, native Workers/Pages preview smoke tests, PDF rendering, Persian text and LaTeX OCR fixtures, permissions and quota tests.
5. Configure operational notifications, audit pruning (30-day suggested retention), AI cost controls and a rollback rehearsal. Periodic pruning SQL is in the schema comments.
6. GitHub Actions production secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are required for a main-branch deployment.

## Rollback

Revert the defective commit on `main` and rerun the validated Pages deployment, or promote the previously verified Pages production deployment from Cloudflare dashboard. No rollback drill has yet been performed.

Do **not** mark ZH-64..ZH-68 complete or merge before checking the outstanding release gates.
