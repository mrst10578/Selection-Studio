# ZH-75 · Multistage OCR and live LaTeX review

Scope: `review-console/ocr-studio.html` in Selection Studio, mounted at `/admin/ocr-studio.html` in the Cloudflare Pages build. This is operator-side transcription only and does **not** overwrite the canonical question/crop metadata.

## Operator workflow

1. **Extract (مرحله ۱).** Import PDF page/image or use the existing handoff from admin review. Press `استخراج متن و گزینه‌ها`. A single authenticated `POST /api/ocr` request transcribes Persian/English prose, numbers, four options, special notation and LaTeX from the original image, with a strict JSON structure. If recognition has multiple separate questions, each receives its own editable local item.
2. **Inspect live.** As the operator types, an independent preview displays regular text and attempts to typeset `$...$`, `$$...$$`, `\\(...\\)` and `\\[...\\]` with pinned KaTeX v0.19.0. Math rendering uses `trust:false`, expansion/size limits and a text-node-only input path. Neither the original OCR text nor the PDF is sent to the KaTeX CDN. If the library is unreachable or a formula is malformed, the **literal source LaTeX** remains visible.
3. **Second pass (مرحله ۲).** Press `بازبینی مستقل متن` to submit the image plus the current transcription as untrusted *data* in an explicit extra request. The model proposes a corrected JSON result. It is **not applied automatically**. The operator sees the proposed text, warnings about changes to numerals, negations, formulae and option counts, and a separate live math preview. They may edit the suggestion, then explicitly accept or reject.
4. **Formula-focused pass (مرحله ۳).** Press `بازبینی دقیق فرمول‌ها` only when useful. It asks the same model to prioritize exponents, fractions, chemistry, decimals and measurement units, still comparing to the image. The same explicit approval applies.
5. **Manual fallback.** Typing always works without OCR access. If an OCR request times out, receives a quota error (429), fails authentication, or produces malformed JSON, the current text remains untouched. A second pass is disabled while no draft text exists.
6. **Final human review.** Checking `متن و فرمول را بررسی کردم` remains an operator action. Any change to the typed text or applying a proposal clears that review state.

## Storage and boundaries

- Model responses are parsed into a bounded `questions[]` structure, with `number`, `stem`, `options`, `extras`, `figure_required`, `uncertainties` and `confidence`. Unknown sections stay marked `⟦نامشخص⟧`. No answer key is generated.
- `structured` and `ocrStage` metadata are saved within OCR's existing local project draft and exported in its **sidecar** JSON. Operator edits invalidate the machine-structured snapshot so that metadata never contradicts the edited transcription. This does not modify canonical acceptance records or PDF crop bounds.
- No browser API token is sent. Same-origin `/api/ocr` relies on Cloudflare Access, D1 limits and the Worker secret. Each pass is an explicit extra metered request. Bulk OCR is capped at **eight currently untranscribed images per click**, with a confirmation; authorization or quota errors stop the batch.
- Math rendering requires a KaTeX CDN download (code and fonts only). This CDN is not an OCR inference service and is never given the prompt, typed text, file or images. If it fails, the user still sees the raw equation and can edit it manually.

## Known limits and final gates

- The CF model's transcription quality and reliable mathematical LaTeX are **not guaranteed**. RTL scientific text, mixed digits, multiple-choice columns, complex reaction schemes and scientific diagrams require page-specific manual verification.
- Browser tests use mocked OCR responses, not paid AI inference. A cost-controlled authenticated *real* Persian PDF/image OCR test remains required before production release, as do Access OTP, production Preview routing, audit, quota and rollback checks.
- HTML typed export continues to preserve the original source LaTeX notation; verify print rendering and offline behavior against representative formulas in final acceptance.
- Test coverage: `qa/ocr-pipeline.spec.mjs`, legacy `qa/ocr-studio.spec.mjs`, `tests/cloudflare-worker.test.mjs`, CI HTML/CSS/Playwright/Lighthouse.
- Work remains in PR #45 on `feat/cloudflare-native-deployment`. Do not merge to `main` or deploy production before the agreed final checks.
