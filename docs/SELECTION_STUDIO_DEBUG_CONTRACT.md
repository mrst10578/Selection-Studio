# Selection Studio — Redesign Debug Contract

Baseline for this debug branch: `adeba6bf9537260b0452a80999065b61be1b63b9`.

This document resolves the redesign ambiguities found during the September 2026 debugging pass. It does not change the public question schema, Worker contract, record identifiers, PDF page semantics, or `bbox_norm` semantics.

## Capability status

| Capability | Status | Contract |
| --- | --- | --- |
| Light and graphite-dark themes | Required in redesign | Both must keep readable text, visible focus, and identifiable controls. |
| Readable Persian UI | Required in redesign | Normal working text must remain readable during long sessions. |
| Comfortable / compact density | Required in redesign | Changing density must not change document/crop meaning or lose the current reading position. |
| Simple focus mode | Required in redesign | Must not hide controls needed to recover from incomplete/invalid state. |
| Save feedback | Required in redesign | Success only after required PDF crops/previews and the record are committed successfully. |
| Contextual guidance / gates | Required in redesign | Missing requirements must remain actionable. |
| Position preservation in current open document/session | Required in redesign | Theme, density, focus/layout refresh, viewer tab switches and resize must preserve the visible document anchor, active page, and valid crop. |
| Drag-resizable inspector width | Optional | Implement only after demonstrated need and with a keyboard-accessible equivalent. Not implemented by this debug pass. |
| Recover local PDF file after browser close/full reload/navigation to an independent page | Out of scope | Browser file handles are not promised or persisted by this phase. |

## Position-preservation boundary

Within the same open page session and same active PDF:
- preserve active PDF page;
- preserve a normalized document-space viewing anchor, not merely raw scroll pixels;
- preserve the valid `bbox_norm` crop;
- preserve an explicit zoom choice if adjustable zoom is added later.

Intentional navigation to another PDF page may start at that page's previously remembered position, or at the top if it has not been viewed before. Replacing the PDF intentionally starts the new document at page 1/top.

A full browser reload, closing/reopening the browser, or navigating between independent pages is a separate recovery problem and is not claimed as file recovery.

## Data-contract boundary

The following remain compatible and unchanged:
- question record shape;
- Worker/service contract;
- record/question IDs;
- PDF page numbering semantics;
- `bbox_norm = [x1,y1,x2,y2]` normalized to the rendered page;
- correct-option validation;
- Level 1–5 stored enum values;
- Biology combined/non-combined validation.

Runtime-only state such as load generation, render generation, committed page readiness, pending file, and view anchor must stay internal to the viewer and must not be added to canonical question records.

Legacy records must remain readable without an undeclared migration. A legacy record's ID, region page and normalized coordinates must retain their previous meaning.

## Crop stability acceptance

For a valid crop on a test document:
1. remember its `bbox_norm` and a visible document anchor;
2. resize the viewport;
3. switch comfortable/compact density;
4. switch question/answer tabs and return;
5. toggle focus mode where present;
6. exercise mobile portrait layout.

The normalized crop must remain exactly unchanged. The overlay may differ by at most about one CSS pixel from the expected position after layout/raster rounding. Anti-aliasing differences are not content displacement.

## Visual reference

### Desktop operator workbench
- top: exam/session controls;
- center/dominant area: PDF document viewer and document tools;
- side inspector: question metadata and primary save action;
- selected/active state: narrow semantic accent treatment, not decorative gradients;
- primary action is consistently discoverable.

### Mobile operator workbench
- header controls remain fully inside the viewport;
- document occupies the main vertical working area;
- crop/browse mode control remains touch reachable;
- metadata follows the viewer without whole-page horizontal overflow;
- required recovery controls are never hidden by focus mode.

### Shared design tokens
- base spacing rhythm: roughly 4/6/8/10/12/14/16 px increments;
- control height: 42–44 px;
- primary corner radii: 8/12/16 px;
- working text: approximately 12 px minimum for secondary microcopy, larger for normal form text;
- selection indicator: semantic blue accent;
- success/warning/danger only communicate state.

## Non-text contrast

Decorative separators and required control boundaries are separate roles.

Light theme:
- decorative strong separator: `#828D99`;
- required control border: `#78838F`;
- measured contrast for `#78838F`:
  - on `#EBEDEB`: about 3.28:1;
  - on `#E4EDF5`: about 3.26:1.

Dark theme:
- decorative strong separator: `#7B8896`;
- required control border: `#8996A4`;
- measured contrast for `#8996A4`:
  - on `#2D343C`: about 4.17:1;
  - on `#293E50`: about 3.67:1.

Focus rings and required selection indicators must remain visibly distinguishable in both themes.

## Screenshot evidence

Before screenshots may only represent states/themes that genuinely existed at the recorded baseline. Do not fabricate a "before dark/light" state that did not exist.

After screenshots, when captured for a design review, must record:
- code SHA;
- viewport dimensions;
- same test document;
- same PDF page;
- same working state/crop;
- delivered theme.

A new screenshot is evidence of the delivered state only; it is not proof that a corresponding prior state existed.
