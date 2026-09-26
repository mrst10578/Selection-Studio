# Selection Studio UX Upgrade Implementation Plan

> **For agentic workers:** Follow the plan task by task and preserve the current data/API contract.

**Goal:** Make question selection, batch handoff, and administrator review clearer, faster, and comfortable on mobile.

**Architecture:** Keep the static HTML/CSS/ES modules and existing Worker contract. Improve the operator workbench and batch page in `studio/`; improve filtered review navigation and explainable decisions in `review-console/`. Do not claim server-backed states where the active local API only provides browser-local data.

**Tech Stack:** HTML, CSS, browser JavaScript modules, Playwright, Axe, Node test runner.

**Spec:** `docs/PRODUCT_GOAL.md` and the accepted UX audit in the preceding conversation.

## Global Constraints

- Android/mobile is a first-class surface.
- Static panels remain deployable to GitHub Pages or another static host.
- Cloudflare Worker is the intended write/API boundary.
- GitHub-backed question metadata remains canonical after review/publish.
- No paid VPS, runtime LLM calls, or OCR as source of truth.
- Keyboard, mobile, accessibility, and reduced motion are required for new UI behavior.
- Merge and deployment remain separate authorization boundaries.

## Review Focus

- Active review filters remain in force when navigating to the next question.
- Batch submitted state is only shown after a successful response.
- Local-only data is labeled honestly and is not presented as server persistence.
- Mobile controls remain reachable without horizontal overflow.
- Review decisions remain reversible and their reasons remain visible.

---

### Task 1: Shared language and responsive readability

**Files:** `studio/index.html`, `studio/selected.html`, `review-console/index.html`, their stylesheets.

- Replace user-facing implementation jargon with concise Persian labels.
- Raise small text sizes and strengthen semantic color/state contrast.
- Keep compact desktop utility while making mobile work areas and actions reachable.

### Task 2: Operator workbench and batch visibility

**Files:** `studio/index.html`, `studio/app.js`, `studio/selected.html`, `studio/selected.js`, `studio/styles.css`.

- Make workflow checks focus their corresponding control.
- Add a durable local batch receipt/status and clear wording for local save versus remote send.
- Add search/filter controls to the selected question list and preserve recoverable deletion.
- Clarify crop modes and improve crop/page navigation affordances where supported by the existing PDF renderer.

### Task 3: Administrator review queue

**Files:** `review-console/index.html`, `review-console/app.js`, `review-console/model.js`, `review-console/console.css`.

- Add test-first coverage for filtered navigation and review-state undo.
- Make quick review skip questions outside the active filtered queue.
- Add direct status counts, persistent reasons, and focused mobile navigation.
- Keep publication confirmation informative and honest about local versus Worker-backed state.

### Task 4: Verification and handoff

**Files:** `qa/ui.spec.mjs`, `review-console/model.test.mjs`.

- Run unit, HTML/CSS, UI, recovery, and accessibility checks available in the repository.
- Create a reviewable PR; do not merge or deploy.
