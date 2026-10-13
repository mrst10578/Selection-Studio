# ZH-85 | Search and explicit publishing intent (pre-integration core)

`engine/bank-search-publish.js` offers local, read-only search against a provided array of already-reviewed question records. Persian/Arabic character and numeral variants are normalized. Deleted, draft, unreviewed and scientifically-blocked questions are excluded.

The `preparePublicationIntent` helper accepts only a bounded set (max 50) of separately reviewer-approved, revision-pinned questions, an explicit operator and an exact confirmation token. It returns **a preview intent only** with `dispatched: false`. No Telegram/LoPRax API request, D1 write, secret, bot credential, or R2 access is performed by this helper.

`tests/bank-search-publish.test.mjs` has three local Node tests for safe filtering, unapproved/stale rejection, and no unintended outbound publication.

Remaining work: authenticated server-side search index, role-based reviewers and cryptographically authorized publication, destination configuration and operator confirmation UI, source image/private R2 inclusion, idempotent delivery/audit, retry, per-destination permissions, and real publishing E2E. This code does not make ZH-85 Completed, and there is no permission to publish anything.
