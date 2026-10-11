# Selection Studio Cloudflare production foundation (ZH-64 .. ZH-68)

## What is provisioned (Zh2 account)

- Zero Trust organization: `Selection Studio Zh2`, auth domain `blue-shadow-a981.cloudflareaccess.com`.
- OTP email identity provider: `d9fd3d2d-3e9c-4fa4-a5a7-21c7e1849d7d`.
- Self-hosted Access application `Selection Studio Operators`, domain `selection-studio-e1c.pages.dev`, app id `25b8d99f-32c8-4bf5-b7de-2ea399eda4ab`, audience `b8242a004bf471634c5245dc720d3e9395e2d748d04ce8438d26038e458895ad`.
- Access policy `Owner operator` allows only the linked Zh2 operator email. Never replace with an Everyone or Bypass policy.
- Separate preview Access application protects `*.selection-studio-e1c.pages.dev`, app id `22a13d6b-437c-4ac0-912b-d04623d78e37`, audience `68959c2d712413dd855eb4b8c44284eb4b3955f8d3469f48368a6b9cf50e8abf`, with an email allow policy.
- Cloudflare Pages project `selection-studio` configured with `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` and `OPERATOR_EMAILS` for production and preview. **Preview uses the distinct preview Access audience**, not the production audience.
- Separate D1 databases prevent preview traffic from consuming production quotas: production `selection-studio-security` (`ae03b8c4-2b05-4f3e-9d3d-151ae77c0dbc`), preview `selection-studio-security-preview` (`241ef565-d9ea-4d5a-b70e-4c115e0e185d`), each bound as `SECURITY_DB`. Schema in `cloudflare/schema-security.sql` was applied through the Cloudflare D1 API. Logs retain pseudonymous actor hashes and event status, not image contents.

**Deployment state**: Configured resources exist, but PR #45 remains unmerged and the new Worker/UI must still be deployed and browser-tested. Existing production Pages artifact is unchanged.

## Routing and policy

- GitHub Actions builds the same native Pages asset tree for `/`, `/studio/`, `/admin/`. Worker serves native `env.ASSETS` (no GitHub Pages proxy).
- `GET /health`: operational routing status.
- `GET /api/session`: validates Cloudflare Access JWT signature, issuer, audience, expiry, and operator email allowlist.
- `POST /api/ocr`: only for verified session, JSON, up to 8 MiB. Uses D1 quota windows (10/minute, 100/day per actor, **30/day global** via `OCR_GLOBAL_DAILY_LIMIT`) and an audit log; **missing binding, audit failure or upstream token => fail closed**. Upstream token never reaches client JavaScript.
- Operator and admin UI use verified /api/session. OCR console uses same-origin /api/ocr. Client-side login state alone does not authorize access.

## Outstanding production blockers

1. **Dedicated OCR upstream now provisioned**: `selection-studio-ocr-secure.zh-st-2.workers.dev/ocr` is a separate Worker with Workers AI binding, secret-protected `ACCESS_TOKEN` and no public CORS allowance. Cloudflare Pages now has matching encrypted `OCR_SERVICE_TOKEN` in preview and production. The original `examforge-free-ocr` Worker and its clients were not modified. New inference still incurs whatever Workers AI usage costs apply, so configure budgets before broad rollout.
2. **Live E2E validation**: Confirm newly deployed upstream and Pages URL through authenticated browser, verify invalid/unauthorized direct Worker calls fail, and run a real low-volume OCR check with consent and cost controls.
3. Test the OTP flow in a real authenticated browser, and confirm preview branch hostnames are actually intercepted by the wildcard Access application.
4. Run the full existing CI, native Workers/Pages preview smoke tests, PDF rendering, Persian text and LaTeX OCR fixtures, permissions and quota tests.
5. Configure operational notifications, audit pruning (30-day suggested retention), AI cost controls and a rollback rehearsal. Periodic pruning SQL is in the schema comments.
6. GitHub Actions production secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are required for a main-branch deployment.

## Rollback

Revert the defective commit on `main` and rerun the validated Pages deployment, or promote the previously verified Pages production deployment from Cloudflare dashboard. No rollback drill has yet been performed.

Do **not** mark ZH-64..ZH-68 complete or merge before checking the outstanding release gates.
