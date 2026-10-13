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

The deterministic proposal engine is implemented and unit tested. ZH-79 remains **In Progress**: connect it to an accessible operator UI, persist reviewed decisions with ZH-80 revisioned D1 API and role enforcement, test end-to-end against a real bank, and design a cost-limited opt-in second-model service if a second inference provider is required. Do not mark task complete on an engine-only commit.

All outputs are advisory and require source-PDF comparison. Numeric warnings are not calibrated probabilities. There are no automatic database writes or publication side effects.

Production PR #45 must remain open until explicit final approval.
