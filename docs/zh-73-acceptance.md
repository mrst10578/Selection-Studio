# ZH-73 | Multi-crop, PDF navigation and mobile handoff

## Implemented on PR #45 (not deployed to production)

- Independent ordered selection queues for question PDF and answer PDF.
- Up to 12 distinct normalized bounding boxes per side, including across pages.
- Add, remove, reorder (accessible ↑ / ↓ controls), clear with confirmation, inspect or download a composite WebP.
- On final save, preserve **all** original `question_regions` and `answer_regions`, while the existing previews store a composite image.
- Mark queued regions as satisfying the readiness gate even after clearing the live crop rectangle.
- Reset every page's crop cache after recording a question. Loading a replacement PDF discards that PDF's queued regions only after load succeeds.
- Page up/down keyboard navigation only when no text field or modal is active, plus existing page-jump input and tab-swipe navigation on mobile.
- Zoom controls, accessible mobile instructions and expanded Persian operator guide.
- All regions are checked in the selector batch gate and the review console, not only the first region.

## Automated coverage

- `qa/crop-queue.spec.mjs`: real PDF registration gate; image composition; cross-page region preservation; ordering, duplicate normalization, keyboard focus protection, and mobile controls.
- `review-console/model.test.mjs`: invalid additional subregion blocks approval.
- `qa/pdf-crop.spec.mjs` plus existing `qa/pdf-real.spec.mjs`: PDF rendering, crop geometry, lock and scrolling regressions.
- Runs: see GitHub Actions on PR #45. Do not claim full acceptance until the latest `Validate Selection Studio` run is green.

## Deferred final acceptance (before merging or production release)

1. In authenticated **preview**, open a multi-page real Persian question PDF and a matching answer PDF.
2. On page 1, add two non-overlapping question rectangles; navigate to page 2, add one more. Reorder them and inspect the composite WebP for legibility and order.
3. Confirm the answer queue is independent, then add answer regions and register one question. Verify record metadata has all page/bbox coordinates and the stored combined previews match.
4. Register a second question from the same PDFs. Verify old regions from **all pages** are gone and cannot accidentally pass readiness.
5. Try a replacement PDF that fails to load. Verify the original PDF and queued regions remain intact. Successfully replace it afterward and verify that side's queue resets.
6. On phone and tablet: scroll PDF in browse mode, toggle crop mode, select a region, use zoom in browse mode, navigate pages, swipe only the tab strip, and ensure nothing horizontally overflows.
7. Validate accessibility focus, visible button labels, PageUp/PageDown when fields are focused, and all error and size-limit states.
8. Check Cloudflare Access session, D1 audit, and a final smoke test on production after approval.

## Invariants

- Do not send PDFs, crop image binaries, or bearer secrets to the cloud-draft API.
- Each saved region uses document-page-relative `bbox_norm`, not screen pixels; the composite preview is supplementary.
- Never merge the PR or deploy main before final approval.
