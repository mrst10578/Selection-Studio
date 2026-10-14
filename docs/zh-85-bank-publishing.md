# ZH-85 | Search and explicit publishing intent (pre-integration core)

`engine/bank-search-publish.js` offers local, read-only search against a provided array of already-reviewed question records. Persian/Arabic character and numeral variants are normalized. Deleted, draft, unreviewed and scientifically-blocked questions are excluded.

The `preparePublicationIntent` helper accepts only a bounded set (max 50) of separately reviewer-approved, revision-pinned questions, an explicit operator and an exact confirmation token. It returns **a preview intent only** with `dispatched: false`. No Telegram/LoPRax API request, D1 write, secret, bot credential, or R2 access is performed by this helper.

`tests/bank-search-publish.test.mjs` has three local Node tests for safe filtering, unapproved/stale rejection, and no unintended outbound publication.

Remaining work: authenticated server-side search index, role-based reviewers and cryptographically authorized publication, destination configuration and operator confirmation UI, source image/private R2 inclusion, idempotent delivery/audit, retry, per-destination permissions, and real publishing E2E. This code does not make ZH-85 Completed, and there is no permission to publish anything.

## 2026-10-13 server integration addendum

`cloudflare/approved-bank-api.js` adds authenticated, **read-only** `GET /api/v1/bank/questions`, actor-project scoping, bounded matching, a SQL-side indexed source-document existence check, and latest-revision independently approved reviewer-event validation. It denies old or rejected revisions. The returned `reviewStatus=approved` is derived server-side from D1; the underlying question stays in draft storage. `POST /api/v1/bank/exams/compose` checks *each* selected question revision again and never dispatches publication. `tests/approved-bank-api.test.mjs` contains actor, review and stale-revision tests. Real external Telegram and LoPRax publishing adapters, destination credentials, dispatch audit/idempotency, rate limiting and final explicit approval remain **not implemented**. The earlier `preparePublicationIntent` remains local-only and non-dispatching.

## 2026-10-14 validated reviewer evidence

`validApproved()` now checks the reviewer event against the owning project's **active** `bank_project_reviewers` grant, the original operator who assigned it, the source PDF SHA-256 link and all six signed scientific checklist fields. A later rejection still invalidates prior approval. Revoking a reviewer also removes affected questions from search and exam composition on the next query. New negative tests cover missing grant, incomplete evidence and mismatched source PDF fingerprint. This is a server-side safety improvement only: no external publishing adapter or dispatch is enabled.
