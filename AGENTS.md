# Selection Studio — Repository Instructions

## Product
Selection Studio is a professional question-selection and review workbench for TestBank.

## Engineering constraints
- Preserve mobile usability; Android/mobile is a first-class surface.
- No paid VPS requirement.
- Static panels must remain deployable to GitHub Pages or another static host.
- Cloudflare Worker is the intended write/API boundary.
- GitHub-backed question metadata is canonical after review/publish.
- PDF crop regions are canonical visual references; do not OCR formulas/diagrams into source of truth.
- Do not add LLM calls to runtime question selection/review flows.
- New UI behavior requires keyboard, mobile, accessibility, and reduced-motion consideration.

<!-- BEGIN ZZZOPS WORKFLOW ADHERENCE -->
Policy digest: `selection-studio-rebuild-v1 / structured / tracked / human_at_exhaustion`
- Work in coherent, reviewable branches/PRs.
- Preserve the complete accepted outcome; do not silently reduce to an MVP.
- Use risk-matched verification before declaring a slice ready.
- Public/data contracts require explicit schema and compatibility checks.
- Deployment is not part of a source-change claim unless separately authorized.
<!-- END ZZZOPS WORKFLOW ADHERENCE -->
