# ZH-75 · Bilingual OCR and human-reviewed LaTeX

## Feature and entry point

The selector opens **Selection Studio → question inspector → استودیو OCR**. This module is opt-in and is not a prerequisite to registering a question.

The implementation uses **the existing secured same-origin `POST /api/ocr` endpoint**, which already checks Cloudflare Access identity, operator allowlisting, daily quotas and an audit trail. The browser never receives the upstream token. The inference model behind the dedicated Worker is `@cf/google/gemma-4-26b-a4b-it`, so OCR may incur Workers AI usage charges.

Three deliberate stages:

1. **تشخیص متن**: explicitly click to send the active selected/collated PDF crop. The model is instructed to transcribe Persian, English, digits and mathematical notation without solving the question. The result is loaded as an **unverified draft**. No requests are sent automatically while typing, cropping or navigating.
2. **بازبینی فرمول‌ها**: a second, **optional and separately clicked** inference pass using the cropped image plus previous draft as untrusted reference. It focuses on signs, fractions, exponents, radicals and TeX. No unrequested second billable call.
3. **تأیید اپراتور**: edit the text, LaTeX lines and uncertainty notes manually. Explicit approval is required before a transcription is attached to the saved record. Any edit removes the approval until it is re-confirmed.

Question and answer drafts are independent, and both may be confirmed. The original PDF cropping, answer key and taxonomy are unchanged. Replacing the PDF, changing the selected regions, or changing the question number invalidates stale transcription state. A multi-page crop is recomposed before OCR, with downscaling safeguards that reject overly tall low-resolution material rather than silently returning unreadable text.

**Live preview:** text is escaped through `textContent`. LaTeX is displayed as source immediately, with optional progressive rendering through pinned KaTeX 0.16.22 assets loaded from jsDelivr. KaTeX is configured with `trust:false`; if network access or rendering fails, readable source remains. The user's PDF and text are **not** sent to jsDelivr; the stylesheet and library JS are downloaded into the browser.

## Data contract

Only confirmed metadata is added to the existing saved local question record:

```json
{
  "ocr_review": {
    "schema_version": 1,
    "question": {
      "text": "متن بازبینی‌شده",
      "latex": ["\\frac{1}{2}"],
      "notes": "",
      "source": "cloudflare-workers-ai",
      "passes": 2,
      "status": "operator_confirmed",
      "confirmed_at": "ISO timestamp"
    }
  }
}
```

`question` and `answer` fields are optional. When nothing is confirmed, **no OCR property** is added. The field flows through the existing local JSONL export and review batch as optional metadata, without altering required `question_regions`/`answer_regions`. No image data or upstream credentials are written in `ocr_review`; images remain stored separately in the existing browser IndexedDB preview store.

Transcription drafts themselves are **not** stored in the local or remote form autosave. Operators should approve and save before leaving the active question. If OCR is unavailable, returns unexpected JSON, runs out of quota or receives a 401/403, operators can still use the manual transcription editor and register the question normally.

## QA

`qa/ocr.spec.mjs` mocks `POST /api/ocr` and covers:
- secure on-click only transport, JSON/prose fallback, Persian/English and math preservation;
- the second, separately authorized pass and changing status after edits;
- explicit human approval before persistence;
- 429 quota fallback with manual entry;
- Access-denied UI with no paid OCR requests;
- mobile touch targets and overflow.

Final-release acceptance (deferred): real authenticated Cloudflare Access browser, actual real-world Persian/English exam PDFs, equation-heavy samples, quota audit evidence, OCR upstream costs, review/publish flow and rollback. None of these are claimed as already executed.

**Release rule:** branch `feat/cloudflare-native-deployment`, PR #45 only; no production deployment or merge during this phase.
