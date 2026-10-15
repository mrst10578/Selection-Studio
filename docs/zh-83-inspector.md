# ZH-83 | Question Inspector review gate

Partial deterministic engine in `engine/question-inspector.js`. It requires: existing draft with a valid source revision, non-empty question text, confirmation of source transcription, answer alignment, taxonomy and any figures, no unacknowledged critical scientific OCR warning, and no unresolved duplicate suggestion. Review evidence is tied to the question revision; a stale version fails closed.

`confirmQuestionInspection` requires an explicit approve/reject decision by a separate reviewer identity from the origin operator and returns signed review evidence. **It never mutates the question, authorizes publication, or changes role assignments.**

Three focused tests in `tests/question-inspector.test.mjs` exercise fail-closed scientific warnings, version staleness, source gaps, possible duplicates and reviewer segregation.

**Still needed:** actual Inspector UI, Cloudflare Access role mapping (current Pages Access is operator allowlist), D1 transactional reviewer evidence with actor controls, reviewer queues, approvals and publication transition, and real PDF E2E/accessibility. Do not mark Completed or deploy production based on this code.
