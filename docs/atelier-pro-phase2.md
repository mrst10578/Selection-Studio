# Ember Atelier Pro | Phase 02 implementation notes

Branch: `feat/cloudflare-native-deployment`  
Review: https://github.com/mrst10578/Selection-Studio/pull/45  
Linear: ZH-69, ZH-70, ZH-71, ZH-72 (partial), ZH-73 (future)

## Scope and safety

`studio/atelier-pro.js` and `studio/atelier-pro.css` are progressive enhancements on the existing `studio/index.html`. They preserve the existing form selectors, `PdfCropper` bindings, normalized crop coordinates, OCR routing and question schema. No PDF bytes, images, login token or upstream API secret are saved in the Phase 02 local draft.

- **ZH-69**: Copper and teal on dark graphite, RTL first, keyboard focus cues, reduced-motion fallback, compact cards and responsive hierarchy.
- **ZH-70**: Genuine three-pane workspace (projects / PDF viewer / inspector). Sidebar/inspector widths are adjustable using a draggable separator or ArrowLeft/ArrowRight/Home/End, double click resets; panels can be collapsed and re-opened from the top bar, with layout persisted in `selection-studio-layout-v3`. Tablet stacks the project dashboard above PDF and inspector; mobile uses one column. PDF fullscreen uses the native Fullscreen API where supported, with a CSS immersive fallback.
- **ZH-71**: `Ctrl+K` / `Ctrl+Shift+P` opens the command dialog. Search accepts Persian and Latin keywords, normalized Persian Unicode, keyboard arrows and Enter. Example: `صفحه ۱۲` or `page 12` jumps to a PDF page. The command listener runs in the capture phase to prevent opening the legacy shortcut help dialog at the same time.
- **ZH-72 (local portion only)**: Local metadata-only autosave with a delay, explicit non-blocking recovery, up to 60 in-memory undo/redo steps, up to 12 saved form revisions, detection of same-browser cross-tab conflicts, a project dashboard grouped by exam ID, and a local metadata-only JSON backup. **There is no server-side draft sync or recoverable PDF file upload yet**. A real multi-device resume needs the future D1/R2 API and conflict-resolution protocol.
- **ZH-73**: Existing PDF crop components remain unchanged; multi-crop, gestures, zoom history and bulk processing will be implemented in a later iteration.

## Important operational details

The JS reads stored question metadata from `testbank-studio.records.v1`, but it never overwrites the canonical `loadRecords/saveRecords` behavior in `studio/store.js`. Version snapshots restore only known form fields. Recovery of saved form values **does not restore PDFs**; operators must re-select their source files.

The original `Ctrl+K` shortcut help remains available from the existing *میانبرها* button and the `میان‌برهای صفحه` palette command.

For acceptance, run:

```sh
node --check studio/atelier-pro.js
npm run qa:html
npm run qa:css
npm run qa:ui
npm run qa:lighthouse
```

Playwright coverage in `qa/atelier-pro.spec.mjs` checks palette activation, searchable actions, dashboard grouping, draft undo/redo and privacy, desktop resize persistence, and mobile overflow.

**Release gate:** Wait to merge or deploy until existing question-crop regression tests and the full UI/Lighthouse suites pass, then conduct real Cloudflare Access, live OCR, and browser end-to-end checks alongside ZH-64..ZH-68 release gates at the end of the project.
