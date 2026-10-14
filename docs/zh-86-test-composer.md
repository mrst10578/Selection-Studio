# ZH-86 | Test Composer first independent export engine

`engine/test-composer.js` generates a pure, deterministic exam manifest from an **explicitly ordered selection** of up to 200 questions. Every included question must carry an explicit approved review status, a valid revision, no pending scientific alerts and must not be deleted or a draft. Missing answer data blocks answer-inclusive exports. This module never publishes anything.

- `exportExamJSONL`: line-oriented UTF-8 JSON records preserving number, question ID and revision.
- `exportExamHTML`: print-ready, semantic right-to-left HTML with HTML-escaped question and answer text. Can be printed to PDF in a browser by an operator, but **is not an implemented native PDF generator**.
- `tests/test-composer.test.mjs`: three isolated Node tests for ordering/JSONL, approval guards, and HTML injection safety.

Remaining work: authoring UI, server-side approval signature verification against actual D1 role-gated reviewer records (client-provided approval flags are insufficient), image/figure embedding from private R2, answer sheet layout, genuine PDF generation, print pagination, secure export endpoint and E2E output checks. Therefore ZH-86 stays In Progress; no production deploy or automatic Telegram action.

## 2026-10-13 operator UI and server validation

Added `review-console/composer-studio.html/js` as a separate responsive approved-question composer. Questions are retrieved from `GET /api/v1/bank/questions`, selected in a user-defined order, and exported only after `POST /api/v1/bank/exams/compose` re-verifies every independently approved D1 source revision. The result is explicitly `publishable:false`. The interface offers HTML, JSONL, and an operator-triggered browser print route with "Save as PDF." Browser printing is **not** a native PDF download generator. `qa/composer-studio.spec.mjs` covers order, exact revision pins and stale-version denial. HTML generation escapes unsafe text and preserves RTL. Production is unchanged, and no external publishing or autonomous PDF/Telegram action takes place. Layout tests with real Persian scientific pages and genuine downloadable PDF export remain open.

## 2026-10-14 print layout

The exported print-ready HTML now explicitly requests A4 pages, preserves right-to-left Persian layout, keeps question sections together when possible and prints the answer key on a **separate page** when answers are included. Output remains escaped, source-order deterministic, local to the operator's browser and unpublishable. Regression tests cover print break, separated answers, order and escaping. The output is HTML/print-to-PDF, not native server-side PDF bytes or a public document.
