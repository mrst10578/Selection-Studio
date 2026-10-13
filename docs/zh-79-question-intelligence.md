# ZH-79 | Duplicate suggestions, taxonomy matching and OCR draft comparison

## Development slice: review-only engine

- studio/question-intelligence.js: dependency-free and offline deterministic matching on the existing, locally available question data. No external embedding endpoint, no LLM calls, no new Cloudflare costs.
- findDuplicateCandidates: score candidates with normalized Persian/Arabic variants, token- and character-overlap; cap scans to 5,000 records and output to 30, support project scoping, ignore soft-deleted records.
- questionSimilarity: numeric and negation differences are explicit flags even when lexical similarity is high. Such scores do not establish scientific equivalence.
- suggestTaxonomy: match only identifiers/keywords from a caller-supplied approved taxonomy catalog. Never invent taxonomy IDs.
- compareModelDrafts: compare two drafts, including formulas, and surface textual / numeric / negation differences. This does NOT independently run two AI models.
- operatorReviewProposal: explicit accept/reject with actor and source revision returns audit evidence; **does not publish, edit, merge or otherwise commit the canonical question**.
- tests/question-intelligence.test.mjs: pure Node tests, run with node --test.

## Scope and open work

The deterministic engine has a **separate operator preview UI** at `review-console/bank-studio.html` (deployed path `/admin/bank-studio.html`), implemented on the feature branch after initial engine tests. It suggests duplicates from the last 50 actor-scoped draft records loaded by the authenticated D1 API, offers a fixed-topic vocabulary and compares a manually supplied second OCR transcription. These analyses never alter or approve text automatically. `qa/bank-studio.spec.mjs` adds mock-API desktop/mobile browser tests. ZH-79 remains **In Progress**: persist reviewed decisions with ZH-80 revisioned D1 API and role enforcement, verify on deployed preview against a real bank, and add opt-in bounded dual-model inference only if necessary. The page exists in branch artifacts only; no production deployment has occurred.

All outputs are advisory and require source-PDF comparison. Numeric warnings are not calibrated probabilities. There are no automatic database writes or publication side effects.

Production PR #45 must remain open until explicit final approval.
