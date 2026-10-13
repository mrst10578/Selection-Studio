# ZH-86 | Test Composer first independent export engine

`engine/test-composer.js` generates a pure, deterministic exam manifest from an **explicitly ordered selection** of up to 200 questions. Every included question must carry an explicit approved review status, a valid revision, no pending scientific alerts and must not be deleted or a draft. Missing answer data blocks answer-inclusive exports. This module never publishes anything.

- `exportExamJSONL`: line-oriented UTF-8 JSON records preserving number, question ID and revision.
- `exportExamHTML`: print-ready, semantic right-to-left HTML with HTML-escaped question and answer text. Can be printed to PDF in a browser by an operator, but **is not an implemented native PDF generator**.
- `tests/test-composer.test.mjs`: three isolated Node tests for ordering/JSONL, approval guards, and HTML injection safety.

Remaining work: authoring UI, server-side approval signature verification against actual D1 role-gated reviewer records (client-provided approval flags are insufficient), image/figure embedding from private R2, answer sheet layout, genuine PDF generation, print pagination, secure export endpoint and E2E output checks. Therefore ZH-86 stays In Progress; no production deploy or automatic Telegram action.
