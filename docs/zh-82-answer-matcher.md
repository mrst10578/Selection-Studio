# ZH-82 | Exam Importer and Answer Matcher, deterministic core

## Implemented development slice

`engine/answer-matcher.js` provides:

- `parseNumberedBlocks`: conservative Persian/Arabic/English numbered text extraction for operator-reviewed question and answer text. It returns suspicious prefixes, duplicate numbers and empty blocks as warnings.
- `matchExamAnswers`: joins blocks on normalized question numbers and reports orphan answer, missing answer, and duplicate question/answer numbers. No best-effort match is silently substituted.
- `explicitMatchReview`: accepts only specifically enumerated, unambiguous matched numbers with a source fingerprint and operator ID. Produces review evidence with `autoPublish: false`.
- `tests/answer-matcher.test.mjs`: four Node tests for mixed Persian/English numbers, mismatches, duplicate labels, and explicit operator decision.

## Safety and limitations

These helpers do **not** import a PDF directly or trigger OCR. Input text must already be reviewed against the source document, and numbering inference can be ambiguous in tables/RTL multi-column pages. They do not write D1/R2, confirm scientific correctness, change canonical question records, or publish anything. Preview/PDF E2E tests and UI integration remain pending.

Remaining ZH-82 work: PDF/answer upload workflow using ZH-81 private R2, operator review UI, page-level provenance, answer-key interpretation, revisioned persistence in ZH-80, and E2E tests using actual Iranian exam PDFs. Leave status In Progress.

## 2026-10-13 integration addendum

Added separate responsive `review-console/exam-importer.html` + `exam-importer.js` (preview route `/admin/exam-importer.html`), linked from the existing OCR and draft-bank consoles. The operator pastes individually inspected OCR question/answer strings. The deterministic matcher shows orphan, missing or duplicated numbers without automatic pairing; individual checkboxes are required. Edits after matching invalidate selections. A private source question-PDF digest must be selected from the existing project. Only selected valid pairs become D1 `draft` records with `sourceNumber`, `sourceDigest`, `answerText`, and `operatorConfirmed:false`; human source and scientific confirmation remain required. Imported pairs are tracked during the session to avoid duplicate retry in the same page. `qa/exam-importer.spec.mjs` covers explicit acceptance and stale analysis on desktop/mobile. Persistence-level idempotency and direct PDF-to-OCR transfer, real R2-backed PDF access and E2E remain open.
