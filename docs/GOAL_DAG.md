# Rebuild Goal DAG

## Root
**G0 — Reconstruct Selection Studio with feature parity and current requested behavior.**

## Dependencies
- **G1 Foundation** → schemas, taxonomy, validators, catalog, QA harness.
- **G2 Selection Workbench** depends on G1.
- **G3 Selected/Batches** depends on G1 + G2.
- **G4 Review Console** depends on G1 + G3.
- **G5 Worker/API** depends on G1 + G3 + G4 contracts.
- **G6 Full verification/recovery package** depends on G2–G5.

## Acceptance
- All required behavior is represented in source.
- Five-level scale is canonical.
- BIO combination hard gates exist across Studio, batch validation, review, and publish.
- Windows desktop shortcuts work without colliding with text entry.
- Responsive and accessibility gates pass.
- Canonical validators reject malformed data.
- Recovery/export does not rely on one GitHub account.
