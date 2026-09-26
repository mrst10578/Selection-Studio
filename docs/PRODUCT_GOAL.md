# Product Goal — Selection Studio Rebuild

## Outcome
Rebuild the lost TestBank project in `Selection-Studio` as a reliable operator console for selecting, classifying, reviewing, correcting, and publishing test-bank questions.

## Primary users
1. Question selector/operator.
2. Review/admin operator.

## Required product surfaces
- Selection Studio workbench.
- Selected Questions / batch submission.
- Independent Review Console.
- Cloudflare Worker API contract.
- GitHub-backed canonical approved records.
- Runtime catalog/index generation.
- QA and recovery/export tooling.

## Core question metadata
- exam/provider/date/operator
- subject: BIO / MATH / PHY / CHEM
- grade: 10 / 11 / 12
- chapter
- unit (BIO: گفتار; others: مبحث)
- difficulty: Level 1 .. Level 5
- correct option: 1 .. 4
- question and answer PDF crop regions
- visual hash / duplicate candidates
- review state and notes
- Biology combination metadata

## Biology combination contract
Every BIO question must explicitly declare combined vs non-combined.
If combined, it must contain at least one additional complete topic:
grade + chapter + unit.
Duplicate additional topics and an additional topic identical to the primary classification are invalid.

## Desktop Windows shortcuts
- Numpad 1–4: correct option.
- F1–F5: Level 1–5.
- Ctrl + top-row digits: chapter (supports 10–12 via short digit chord).
- Alt + top-row digits: unit/topic.
- Shift + 1/2/3: grade 10/11/12.

## Hard UX gates
A question cannot be registered if any required field/crop/biology decision is incomplete.
A batch cannot be submitted while any active question is incomplete.
Approved questions cannot be published if they fail the same quality contract.

## Non-goals for rebuild phase
- No paid VPS.
- No LLM dependency in runtime.
- No OCR as canonical representation.
- No deployment until source and QA reconstruction are complete.
