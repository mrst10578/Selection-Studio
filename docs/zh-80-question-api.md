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

ZH-80 is **In Progress**: user-role/team entities and reviewer privileges, full RBAC, secure audit for every mutation, schema migration/backup drill, pagination/filter/search, data export/recovery, API version negotiation, preview authenticated browser verification, and integration with the operator console remain open. The stored draft content does not prove that OCR text was operator-approved; later ZH-83 must verify that before any transition out of draft. Do not use this API for production publishing.
