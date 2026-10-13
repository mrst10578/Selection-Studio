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
