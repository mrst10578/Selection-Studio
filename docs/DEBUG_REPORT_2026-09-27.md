# Selection Studio Debug Report — 2026-09-27

Repository: `mrst10578/Selection-Studio`

- Original debug base: `adeba6bf9537260b0452a80999065b61be1b63b9`
- Base re-check before PR: unchanged at `adeba6bf9537260b0452a80999065b61be1b63b9`
- Tested implementation SHA: `91ea220d5c6ae839ed0c52991d5e9bb945e63cc0`
- PDF.js runtime version: `4.10.38`
- Browser verification: Playwright Chromium, desktop + Pixel 7/mobile projects
- Real-engine PDF integration: generated legal mixed-script test PDF rendered by the project's actual PDF.js path
- User's original problematic PDF: not available in this debugging conversation

## Item-by-item result

| # | Type | Status | Reproduction / evidence | Change | Verification | Remaining limitation | Tested SHA |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Redesign specification + runtime behavior | اصلاح و آزمون شد | Current viewer re-rendered on tab/layout changes and mobile render code reset scroll. Position-preservation boundary was ambiguous. | Added explicit current-session position contract. Viewer now preserves a normalized document-space anchor per page across refresh/resize/tab/layout changes and separate mobile browse anchors across crop-mode toggles. | Controlled crop test preserves anchor/region/hash through resize and crop-mode toggles. Real PDF test preserves crop and anchor through question/answer tab, density, theme and focus changes. | Full browser close/reload and local-file recovery remain out of scope. | `91ea220d…` |
| 2 | Redesign specification | مشخصات اصلاح شد | Required vs optional ideas were not cleanly classified. | Added capability status table: themes/readability/density/focus/save feedback/contextual guidance/current-session position are required; drag-resizable inspector is optional; persistent local-file recovery is out of scope. | Contract review + existing UI tests for delivered required features. | Optional panel resizing was intentionally not implemented because no demonstrated need/keyboard-equivalent requirement was established. | `91ea220d…` |
| 3 | Data compatibility | اصلاح و آزمون شد | Viewer hardening needed runtime generations without leaking them into canonical records. | Kept record/Worker/ID/page/`bbox_norm` contracts unchanged; load/render generations and readiness remain runtime-only. | Legacy-record Playwright test reads old ID, page numbers and normalized boxes unchanged. Canonical/runtime pipeline also passes. | None found for tested legacy shape. | `91ea220d…` |
| 4 | Crop/layout integrity | اصلاح و آزمون شد | Existing tests did not prove crop stability through layout rerenders. | Atomic committed frame + document-anchor preservation; crop overlay still derives from normalized coordinates against current canvas geometry. | Controlled resize test: exact `bbox_norm`, same visual hash, overlay error <=1 CSS px. Real PDF test exercises tabs/density/theme/focus. Mobile rotation test added. | Anti-aliasing/raster differences are intentionally not treated as content displacement. | `91ea220d…` |
| 5 | Branch freshness / delivery | اصلاح و آزمون شد | Start freshness alone was insufficient. | Recorded starting base and re-read `main` immediately before PR preparation. | Base stayed exactly `adeba6bf…`; no reconciliation was required. Full CI passed on implementation head. | Must re-check again if main changes after this report and before merge. | `91ea220d…` |
| 6 | Accessibility / visual tokens | اصلاح و آزمون شد | Existing `#828D99` control border was below the required 3:1 on light subtle/selection surfaces. | Split decorative `--line-strong` from required `--control-border`; light controls use `#78838F`, dark controls `#8996A4`. | Playwright computes contrast in both themes: required borders >=3:1, normal text >=4.5:1, active accent indicator >=3:1. HTML/CSS/Axe/Lighthouse pass. | None for tested theme combinations. | `91ea220d…` |
| 7 | Redesign specification | مشخصات اصلاح شد | “Personality/artistry” was not objectively testable. | Added desktop/mobile reference hierarchy, spacing rhythm, control height, radii, typography floor, semantic selection indicator and quality criteria based on discoverability/readability/stability. | Existing responsive/A11y tests + documented measurable reference. | Visual taste remains subjective outside the measurable contract. | `91ea220d…` |
| 8 | Evidence specification | مشخصات اصلاح شد | A fabricated “before” for a previously nonexistent theme would be misleading. | Documented that before screenshots may only show real baseline states; after evidence must record SHA/viewport/document/page/work state/theme. | Documentation review. | This pass did not fabricate historical screenshots. | `91ea220d…` |
| 9 | PDF rendering direction / mixed script | نیازمند فایل نمونه | Base HTML is RTL while the old canvas had no independent direction. The original problematic user PDF is unavailable. | PDF stage + canvas are explicitly LTR; render context direction is set to LTR after every canvas dimension reset. Font/CMap/standard-font/wasm settings remain enabled. | Real PDF.js integration generates and opens a legal PDF containing Persian, Latin, digits, symbols and formulas; canvas is nonblank and stage/canvas are LTR. Controlled test verifies context direction. | Cannot claim the user's specific scrambled PDF is fixed until that exact file/page is compared with a reference viewer. | `91ea220d…` |
| 10 | PDF page/render race | اصلاح و آزمون شد | Old code changed `page` before async render completion and `cropBlob()` copied whatever pixels were currently on the visible canvas. | Render to an offscreen temporary canvas; commit only when document generation + page + render generation still match. Crop requires a committed ready frame matching the region page. | Delayed page-2 regression: early crop throws `PDF_CROP_NOT_READY`; after completion, metadata, region and sampled pixels all belong to page 2. | None found in controlled/browser tests. | `91ea220d…` |
| 11 | Concurrent PDF loading race | اصلاح و آزمون شد | Old `loadFile()` had no load generation; slower old selection could overwrite newer selection. | Added independent load generation, stale checks after awaits, candidate-document commit, and cleanup. Question/answer croppers remain independent instances. | Controlled A-slow/B-fast and reverse completion-order tests; only the latest requested file becomes active. | None found in tested race orders. | `91ea220d…` |
| 12 | Failed PDF replacement / save consistency | اصلاح و آزمون شد | Old code assigned `this.file` before successful load and form handlers had no stable failure recovery. Question record was saved before crop preview generation. | Active committed document/file is separate from pending replacement. Failed new file preserves prior identity. Session readiness validates committed file names. Question save captures both crops + stores previews before appending record; failures never emit false success. | Controlled broken-after-good test + real PDF.js invalid replacement test. Old canvas/content and active name remain; input clears; previous doc is reported preserved. | Password-error behavior depends on PDF.js-supported exception path, but has explicit operator messaging. | `91ea220d…` |
| 13 | Mobile scroll / rerender | اصلاح و آزمون شد | Old render ended mobile browse rerenders with `scrollTop=0`; tab refresh and resize could jump to the top. | Removed unconditional reset; preserve normalized document anchor by page, preserve separate mobile browse anchor through crop-mode toggle, and keep coarse-pointer devices in mobile mode after landscape rotation. | Controlled mid-page resize test, crop-mode round trip, portrait→landscape rotation test, and real-PDF layout-change test. | Intentional page navigation to an unseen page still starts at top by policy. | `91ea220d…` |
| 14 | Accidental crop clearing | اصلاح و آزمون شد | Old `up()` called `clearRegion()` for drags under 12px. | Invalid/short drag and pointer cancel repaint/preserve prior valid selection; only explicit clear removes it. New valid crop replaces it normally. | Controlled short tap/short drag/cancel regression passes. | None found in tested pointer paths. | `91ea220d…` |

## Verification summary

The tested implementation SHA `91ea220d5c6ae839ed0c52991d5e9bb945e63cc0` passed:

- JavaScript syntax checks
- Worker core tests
- HTML validation
- CSS/stylelint validation
- desktop + mobile Playwright UI tests
- Axe accessibility checks embedded in UI suite
- controlled PDF concurrency/render/crop regressions
- real PDF.js mixed-script integration and invalid-replacement regression
- 360 px and 390 px mobile checks
- Lighthouse gates
- canonical bank validation
- runtime catalog semantics
- recovery archive build/upload

## Original-PDF limitation

The direction isolation is a safe, evidence-backed mitigation and the mixed-script real-PDF integration passes. However, because the user's original PDF/page that exhibited scrambled words was not supplied to this debugging conversation, item 9 remains **نیازمند فایل نمونه** rather than “confirmed fixed on the original file”.
