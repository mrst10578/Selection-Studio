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

## Phase 2 draft sync (ZH-72)

The authenticated `GET /api/draft?project=workspace` endpoint returns the most recent form metadata (or `revision:0` for a new profile). `PUT` accepts only whitelisted string form fields, `baseRevision` and 8 KiB of JSON maximum. It uses an atomic compare-and-swap update on Cloudflare D1 and returns HTTP 409 with the current revision when another device saved first. `GET /api/draft?project=workspace&history=1` returns the 12 most recent versions. Auth and email allowlist requirements are the same as `/api/session`.

Client-side form edits are saved locally immediately and synchronized asynchronously. When local and remote versions differ, **the app does not silently choose either**: the project dashboard offers explicit recovery or retaining the current form. Failed network saves keep the local copy. PDF files, page rasters, crops, passwords and private session tokens are never uploaded as draft metadata.

D1 schema definitions are in `cloudflare/schema-security.sql`; the two added draft tables were provisioned in both the production and preview databases. Browser QA uses a local identity fixture and is not a substitute for live Access testing.

## Multi-region PDF capture (ZH-73)

`studio/crop-queue.js` adds a bounded queue of up to 12 normalized page regions per question and per answer. The current (unqueued) crop is included in the final selection. Selected regions may span multiple PDF pages. Each image crop is composed vertically into a WebP preview, preserving the existing single-preview storage contract while writing all `question_regions` and `answer_regions` in the question metadata. The original PDF remains untouched.

The UI includes list navigation, removal, clear-all, zoom, touch-safe tab switching and a temporary composite preview. Queues remain in memory and clear only after a successful question save or successfully loading a different PDF. A failed replacement does not erase previous selections. PDF binaries and in-memory crop queues are intentionally not synchronized between devices. Operator still needs the original PDF on the target device.

The review/export consumers should be inspected before release to ensure they preserve and display multi-region metadata correctly. Live OCR, release verification and cross-device browser trials are deferred to the final acceptance phase by agreement.

## Experimental operator-approved PDF region suggestions (ZH-74)

`studio/region-detector.js` analyzes a downsampled canvas copy (maximum 700×1000 px) locally, finding dark text bands separated by whitespace and returning normalized candidate boxes. No image leaves the browser; no Workers AI request or OCR budget is consumed. Suggestions are never written automatically. The operator can inspect an individual suggestion or explicitly add the proposed boxes to the pending crop queue, then correct them with existing crop controls.

This heuristic is designed as a **low-risk first pass, not a validated AI question detector**. It can merge dense questions, split headings incorrectly, and miss two-column arrangements or images. It requires actual Persian workbook/answer key QA before this issue can be marked complete.


## ZH-78 | Durable OCR batch queue (development branch only)

The operator UI can stage up to six question/answer crops, submit a specifically authorized OCR batch, inspect durable per-item progress, and pause/resume/retry/cancel. The system uses the same signed Access identity as interactive OCR; D1 holds scoped job and item state, R2 holds temporary private image/prompt payloads, and a dedicated Cloudflare Queue consumer invokes the isolated OCR Worker under server-side quotas and audit. A seven-day scheduled retention sweep is defined for the consumer. Duplicate messages are lease-protected and an idempotency key guards repeated batch submissions. OCR responses remain operator-review candidates and never silently overwrite registered questions.

**Not active in production:** Queue, R2 and consumer bindings are intentionally deferred to the final preview/production approval phase. Detailed API contracts, isolated preview consumer config, migration checklist, retry limitations and explicit release blockers: [docs/zh-78-ocr-batch.md](../docs/zh-78-ocr-batch.md).


## Operator-only preview readiness (2026-10-15)

`GET /api/readiness` now returns non-secret dependency-presence indicators **only after signed Cloudflare Access verification and operator authorization**. It distinguishes the D1 binding, private question-asset R2 binding, OCR-input R2 binding, Queue **producer** binding, OCR upstream secret presence and reviewer allowlist presence. It never returns the values of any tokens, secrets, emails or object URLs.

The result is a **preflight only**, not proof that the Queue consumer is deployed, the R2 bucket is valid, or that paid model inference works. An unconfigured binding is false; it does not silently permit uploading raw crops to D1 or another public service. Regression tests enforce no unauthorized access and no secret-value disclosure.

As of 2026-10-15, the free-plan, zero-consumer preview Queue `selection-studio-ocr-jobs-preview` is provisioned (id `c8c0553e357343a4ad534b9e02126272`). R2 activation still needs the account owner's billing/checkout decision; GitHub Actions' Cloudflare credential secrets are still absent so the new `deploy-preview` job skips the deployment rather than targeting Production.


## Production release safety gate (2026-10-15)

`.github/workflows/deploy-cloudflare-pages.yml` deliberately no longer deploys Production on a push to `main`. A Production deployment now requires all the following **together**:

1. The workflow is manually dispatched on `main` with the boolean input `release_production=true`.
2. The usual static build and Node security tests complete.
3. A dedicated `release-qa` job passes worker tests, Playwright UI checks, HTML/CSS validators, Lighthouse and canonical catalog verification.
4. The GitHub Actions `production` environment authorizes the deployment, and Cloudflare credentials exist.

Until then the Production deployment job skips, even if a pull request is merged. This is a safeguard, **not** permission to merge PR #45 or deploy without the owner's explicit acceptance. The Preview branch job remains isolated and itself requires GitHub Actions Cloudflare secrets. A new regression test in `tests/release-gates.test.mjs` protects these conditions.
