# ZH-74 · Local page region detection and operator review

Scope: Selection Studio's `PDF question` / `PDF answer` cropping workspace on the development branch.

## Processing and review

1. The PDF is rendered locally by PDF.js into the existing canvas. The operator clicks **پیشنهاد کادرها** on the active page.
2. A downscaled (up to 700 × 1000) copy is segmented in-browser using ink rows, vertical whitespace, and (when possible) two-column layouts. No PDFs, pixels or text are sent to a third-party service by this tool.
3. The dialog overlays proposed normalized bounding boxes directly on a preview of the page. Proposals are **unchecked by default**. Candidate labels such as *گزینه احتمالی* describe a hypothesis, **not recognized text or guaranteed option identity**.
4. The operator can select individual suggestions, select all explicitly, or edit left/top/right/bottom coordinates (percentages) for each box. Invalid boxes are rejected.
5. Press **افزودن کادرهای تأییدشده** to put only selected candidates into the existing multi-crop queue, respecting the 12-region limit. No proposals are queued just by opening the dialog.
6. Press **بازبینی روی PDF** on a candidate to view the suggested box in the original cropper for manual correction instead.
7. Suggestions are invalidated if the PDF document or rendering/page changes before acceptance. Crops remain in the PDF's normalized coordinate system.

## Limits and safety

- This is conservative deterministic **visual segmentation**, not OCR, and does not infer which multiple-choice option is correct.
- Supports row-separated candidate blocks, common four-vertically-stacked option layouts, and a conservative two-row/two-column RTL option pattern.
- Scanned images, unusual diagrams, low contrast, multi-column mathematics, densely packed text, and PDFs with unusual margins can produce incomplete or inaccurate results. The operator must visually verify each box.
- The algorithm never modifies question metadata, answer keys or the original PDF. It does not automatically enqueue candidates.
- No new Cloudflare AI or paid inference endpoint is used for this feature.

## QA

- `qa/region-detector.spec.mjs`: segmented rows, two-column options, blank and unaligned examples, normalized bounds, explicit selection, numeric validation, manual review and mobile dialog geometry.
- Existing `qa/crop-queue.spec.mjs` and `qa/pdf-crop.spec.mjs`: non-destructive queue, page selection, normalized geometry and registration behavior.
- Final acceptance after preview deployment still requires manual tests with varied real Persian question-booklet PDFs, mathematical notation, tables, four-option layouts and touch devices.

Release control: PR #45 stays open. Do not merge or deploy the main site until separate final smoke, authentication, OCR and rollback checks are complete.
