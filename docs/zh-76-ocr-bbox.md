# ZH-76 · Bidirectional OCR text/image alignment & selective re-OCR

## Implementation

- `studio/ocr-bbox.js`: bounded, normalized [x1,y1,x2,y2] coordinates; text character ranges and overlap checks; deterministic span replacement; image-only cropping; sanitized mapping provenance.
- `studio/ocr-image-map.js`: interactive, touch/pointer-accessible composite-crop image, boxes and list; clicking a box selects corresponding text, selecting text and drawing a box creates a manual link. Supports selected-region OCR and a separate editable accept/reject proposal. The PDF cropper's original selection is never modified.
- `studio/ocr-core.js`: optional `segments` with exact offsets and `bbox_norm` in the model prompt/response. Missing/ambiguous/invalid model bbox data is **not guessed**. Human review is still required before approved mapping metadata is included.
- `studio/ocr-panel.js`: retains per-kind (question/answer) composite image raster in memory, handles link selection, selective OCR requests via the authenticated same-origin `POST /api/ocr`, explicit acceptance, rejection, stale-source abort, and review state. Updating the underlying text invalidates old mapping offsets; adjusting notes or LaTeX without changing the transcription preserves links. No silent model result replacement.
- `studio/ocr-panel.css`: constrained mobile layout, visible selected boxes, keyboard focus ring and touch-drag drawing surface.
- `qa/ocr-bbox.spec.mjs`: desktop/mobile tests for malformed regions, normalization, bidirectional mapping, no-request local snapshot, provenance, selective accept/reject, stale document response, and no page overflow.

## Operator workflow

1. Choose a question or answer PDF and one or more crop regions as before.
2. In the OCR panel either perform the existing first/second OCR passes or type the transcription manually. To attach coordinates manually, click **نمایش برش بدون OCR**, highlight a precise text span inside the text editor, click **اتصال متن انتخاب‌شده به تصویر**, and drag its bounding rectangle on the composite image.
3. Click any displayed box or chip to select its linked character span in the editor; click within the already-linked text to highlight its box.
4. Click **OCR مجدد همین محدوده** only for a selected link. It crops **only that region of the local composite image** before a paid upstream request. A separate text proposal appears while the original stays intact. Reject it or edit and accept it. Accepting only changes the linked text range and shifts subsequent offsets as needed; final OCR review approval is cleared and must be reaffirmed.
5. Click the existing **۳ · تأیید اپراتور** to attach the checked `ocr_review` to the question record. The original PDF crop, answer key and taxonomy remain unchanged.

## Data, security & limitations

`ocr_review.question.image_map` or `ocr_review.answer.image_map` is optional, only attached after human confirmation:

```json
{
  "coordinate_space": "ocr_composite_image",
  "source_regions": [{"page":3,"bbox_norm":[0.2,0.15,0.85,0.75]}],
  "links": [{"start":0,"end":5,"bbox_norm":[0.1,0.15,0.55,0.3],"source":"operator"}],
  "events": [{"type":"linked_manually","link_start":0,"bbox_norm":[0.1,0.15,0.55,0.3],"at":"2026-10-13T00:00:00.000Z"}]
}
```

Coordinates are **relative to the OCR composite image** (stacked multi-region captures with gaps), NOT physical source PDF pages. `source_regions` lists the constituent page rectangles, but does not provide a mathematically exact reverse coordinate transform; do not present these bboxes as page-local geometry. Original PDF files and image blobs are not stored inside the text metadata or transmitted to any image rendering CDN. A user-triggered selected-region OCR uses existing Cloudflare Access, quota, audit and private upstream token. Manual cropping and text linking generate no paid inference calls.

There is no guaranteed text localization if the model supplies no trustworthy spans. Operators can manually associate text with an image portion. Complex RTL line layouts, diagrams, text near crop seams, invisible formula symbols and selected-region inference accuracy need real Persian exam PDFs and explicit operator QA.

## Testing & release gate

Automated fixtures/mock OCR, browser responsive/a11y tests and CI are part of the development branch. Authenticated Cloudflare browser runs with real Persian PDF/OCR, API quota/cost checks, release/rollback drill and production merge/deployment remain **deferred to final project acceptance** as previously requested. The PR must not be merged to main without approval.
