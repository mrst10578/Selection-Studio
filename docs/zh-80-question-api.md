# ZH-80 | D1-backed draft project and question API (development slice)

## Contracts

Routes (all under signed Cloudflare Access JWT verification and operator allowlist in `cloudflare/_worker.js`):

- `GET/POST /api/v1/projects`: list/create project drafts.
- `GET/PATCH/DELETE /api/v1/projects/:uuid`: view/rename/soft-delete (PATCH/DELETE require `baseRevision`).
- `GET/POST /api/v1/projects/:uuid/questions`: list/create DRAFT questions.
- `GET/PATCH/DELETE /api/v1/projects/:uuid/questions/:uuid`: read/update/soft-delete one actor-owned draft (PATCH/DELETE require `baseRevision`).
- `GET /api/v1/projects/:uuid/questions/:uuid?history=1`: previous and current revisions, up to 30, while question is active.

All responses carry `Cache-Control: no-store`; unknown actor and cross-actor project/question IDs fail closed. Revision mismatches return 409. Write payloads have bounded sizes/field allowlists. The state is unconditionally `draft`; no API operation publishes, approves, auto-matches, or changes the canonical GitHub bank.

## Migration and testing

- `cloudflare/schema-question-bank-v1.sql` is an additive migration **applied to the preview D1 only on 2026-10-13** after obtaining pre-migration Time Travel bookmark `00000004-00000000-00005103-7a071c335e76533d09a168486715aa48`. Cloudflare query API reported success for all seven statements; post-migration sqlite_master verification found three tables, two indexes and two history triggers. No production D1 database was modified. This is schema verification only; authenticated preview app E2E has not yet been run.
- Three tables: actor-scoped `bank_projects`, `bank_questions`, and append-only `bank_question_revisions`. SQLite triggers automatically snapshot each question insertion and revision change in the same transaction. The API performs compare-and-swap updates and soft deletion.
- `tests/question-api.test.mjs` tests fail-closed setup, actor isolation, draft-only validation, revision conflicts, history and soft deletion using in-memory Node SQLite.
- `.github/workflows/deploy-cloudflare-pages.yml` packages `cloudflare/question-api-v1.js` with the Pages Worker for preview artifact building, but its deploy job remains gated to main and this PR remains unmerged.

## Outstanding requirements

ZH-80 is **In Progress**: `review-console/bank-studio.html` and `bank-studio.js` now provide a separate draft-only operator UI with project create/list, question create/update/soft-delete, revision history, local suggestions and explicit conflict alerts. `qa/bank-studio.spec.mjs` adds mocked-API desktop/mobile browser regression tests. The additive schema is on preview D1 only; the application route is **not deployed to preview or production**. User-role/team entities and reviewer privileges, full RBAC, secure audit for every mutation, preview authenticated browser E2E, complete export/recovery and team sharing remain open. The stored draft content does not prove that OCR text was operator-approved; later ZH-83 must verify that before any transition out of draft. Do not use this API for production publishing.

## 2026-10-13 source and operator review extensions

Question content validation additionally supports `sourceNumber` (1..9999), `sourceDigest` (SHA-256 PDF), `operatorConfirmed` (explicit checkbox), and `scientificPending` (bounded integer). The draft bank UI invalidates operator confirmation when source/text changes. Separately authorized reviewer decisions are stored in an independent review-event table and do not mutate question draft state. Private asset storage metadata has been added to preview D1, but R2 and distinct reviewer E2E remain unavailable pending infrastructure.
