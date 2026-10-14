# ZH-83 | Independent Cloudflare Access reviewer signoff, development implementation

## Server authorization (no production change)

- `cloudflare/_worker.js` validates the signed Cloudflare Access JWT, then classifies identity into `OPERATOR_EMAILS` and separately configured `REVIEWER_EMAILS` allowlists. Reviewer-only sessions cannot use operator CRUD, draft, OCR, or batch routes. A missing reviewer allowlist rejects reviewer access; do not assign the owner's email to bypass this control.
- Operators assign **only pre-approved reviewer email addresses** to their own projects using `POST /api/v1/reviews/assignments`. Only their SHA-256 normalized-email digest is stored in D1; not an Access JWT or service credential.
- Reviewers read only their assigned project set via `GET /api/v1/reviews/assigned`, and draft question lists via `GET /api/v1/reviews/projects/:projectId/questions`.
- Each question can be inspected with `GET /api/v1/reviews/projects/:projectId/questions/:questionId`. Source/answer PDFs are privately downloaded only for assigned reviewers at `GET /api/v1/reviews/projects/:projectId/assets/:digest`; the owner R2 key is never exposed.
- `POST /api/v1/reviews/projects/:projectId/questions/:questionId`: explicit `approve`/`reject`, source `baseRevision`, and six checklist booleans. Approve requires operator confirmation, no reported pending scientific warning, a content-linked source digest existing as a private registered question PDF, complete checklist, and a distinct assigned reviewer. Revision check occurs again inside an atomic conditional INSERT SELECT. Decisions are immutable events and never set `bank_questions.state` or send a publication request. Rejections can be recorded without complete evidence to send bad drafts back.
- A failed security-audit insert prevents a new review event. Audit stores hashed actor and question ID, not question content or secrets.

## Preview migration and rollback point

On 2026-10-13, `cloudflare/schema-review-v1.sql` was applied to **selection-studio-security-preview only**. All four statements succeeded, and two tables plus two indexes were verified in sqlite_master. Pre-migration Time Travel bookmark: `00000006-00000000-00005103-7888ae2b4efc0a66fd529d2aa95cdae2`. Production D1 is unaffected.

## Operator and reviewer UI

- `review-console/bank-studio.html/js`: source PDF selection, explicit operator attestation invalidated by editing, and allowlisted reviewer assignment.
- `review-console/reviewer-studio.html/js`: separately authenticated review queue, read-only question/answer, private PDF link, checkboxes and recorded decision history.
- Browser specifications `qa/reviewer-studio.spec.mjs`, Node `tests/question-review-api.test.mjs`. CI results are required before counting these as fully verified.

## Remaining final gates

The project has no configured real, distinct reviewer account yet. Before any production release, add approved reviewer identity and separate Cloudflare Access policy plus `REVIEWER_EMAILS` in preview, activate private R2 (currently unavailable), test actual PDF links, and perform role/permission/accessibility E2E and final science-review checks. Review results are not currently consumed by a server-only publication/composer API. **Do not mark completed and do not merge PR #45 until the user approves final release.**

## 2026-10-14 reviewer revocation

The project owner can now revoke an approved reviewer via `DELETE /api/v1/reviews/assignments` using a project UUID and the same allowlisted reviewer email. The reviewer’s normalized-email digest is deleted from the project grants table only after a successful security-audit write. The access decision is re-evaluated on each reviewer request. The server-side approved bank now requires an active project grant that was recorded by the owning operator, a matching PDF digest, and all six true review checks. Thus revocation removes historic signoffs from all subsequent search/export responses without mutating old immutable review events. The operator console exposes a confirmation-gated revoke action; the new automated tests cover authorization and invalidated bank results. R2 and a real separate reviewer account remain deployment blockers.


## 2026-10-15 security hardening: reviewer grant generations

Independent sign-off is now linked to a unique `grant_id` generated at reviewer assignment. The reviewer event records this generation. A revoked reviewer who is later re-assigned receives **a different grant_id**; their past decisions remain invalid even if the project and email are unchanged. Existing assigned reviewers with legacy empty grant IDs must be re-granted explicitly; legacy approvals fail closed until a fresh review. Private reviewer PDF access also requires an active nonempty grant.

Preview D1 migration `cloudflare/migrations/20261015-reviewer-grant-generation.sql` was applied to **selection-studio-security-preview only**, after recording Time Travel bookmark `00000008-00000000-00005104-59c8512e463b2a7031e53dc01d9aa116`. Both ALTER TABLE operations succeeded and both columns were verified. Production D1 remains unchanged. New installations use the updated `cloudflare/schema-review-v1.sql` baseline. Tests cover revoke, regrant rotation, and inability to resurrect old approvals.
