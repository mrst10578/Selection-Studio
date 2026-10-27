# ZH-77 | Figure extraction and critical scientific OCR review

## Summary

This is an operator-controlled quality layer on top of the existing ZH-75/76 transcription and image-map workflow. It does **not** automatically edit the original PDFs, the crop queue, answer keys, taxonomy, or published question metadata.

### Scientific-difference alerts

`studio/ocr-science.js` provides deterministic, conservative comparison rules:

- Persian/English negation and exception wording, including `نیست`, `نادرست`, `به جز`, `not`, `except`.
- Minus signs on numbers and algebraic symbols (including Unicode minus variants).
- Decimal separators (ASCII dot, comma and Persian/Arabic decimal mark).
- Superscripts and LaTeX exponent notation.
- Numeric-value changes across OCR passes.
- Missing multiple-choice options (1–4 / الف–د) and options lost during second-pass OCR.
- Optional bounded uncalibrated confidence reported by the OCR model, plus bounded model-proposed warning details.

Comparison findings are **suspected transcription changes**, not a proven answer or a model accuracy score. Only warnings supported by a concrete difference between two transcription versions receive `critical` severity for that difference. Heuristic presence alerts are `review` severity except for an apparently incomplete set of multiple-choice options. An absent option list without a detected option label is **not** automatically called incomplete because essay-style questions exist.

If any critical warning is still unchecked, the existing **۳ · تأیید اپراتور** action is disabled for that OCR transcription. The underlying *question registration* can still proceed without OCR metadata, preserving the original optional OCR behavior. Checking warnings records an operator acknowledgement, not proof that the OCR is correct. Every change to the transcription invalidates its old approval; text/LaTeX edits recompute warnings, while notes alone invalidate approval but do not fabricate new model confidence.

Before second-pass OCR, the previous text/LaTeX/notes is snapshotted. The first-pass transcription may be restored without running paid inference. Selective re-OCR also preserves the immediately previous text for explicit reversion.

### Figure handling

`studio/ocr-core.js` can accept an optional model `figures` array of `{bbox_norm,type,label,confidence}` in addition to transcription/links. Each candidate must have a valid finite `[left,top,right,bottom]` rectangle in the **OCR composite image** coordinate space. Invalid boxes, exact duplicates and tiny elements are rejected. Model output is only a proposal.

The operator may also choose **انتخاب شکل روی تصویر** and draw their own rectangle. The review list can open/download the **actual original-image pixels** extracted with `cropOcrBox` into a local WebP; no generative reconstruction or diagram hallucination is involved. The figure crop is never sent to an external CDN and drawing/cropping are free/local; performing normal OCR elsewhere remains subject to Cloudflare quotas and server-side auth.

A proposed/manual figure must be explicitly marked **تأیید شکل** before it appears in the optional saved `figures` metadata. Removing a figure or editing an approval invalidates the OCR operator approval. The separate WebP is offered for immediate download; images are *not* base64-embedded in the OCR review metadata (underlying question crop stays in its existing capture source). A future R2-based asset pipeline should store extracted file bytes durably if independent figure assets are needed for publication.

### Saved record extension

When optional OCR transcription is operator-approved, `ocr_review.question` and/or `ocr_review.answer` now also carry:

```json
{
  "scientific_review": {
    "status": "operator_checked",
    "warnings": [{"id":"options_incomplete","severity":"critical","message":"...","detail":"...","origin":"heuristic"}],
    "acknowledged_ids": ["options_incomplete"],
    "pending_count": 0,
    "model_reported_confidence": 0.59,
    "confidence_calibrated": false
  },
  "figures": {
    "coordinate_space": "ocr_composite_image",
    "items": [{
      "bbox_norm": [0.15,0.2,0.72,0.81],
      "type":"graph","label":"شکل ۱",
      "source":"operator",
      "status":"operator_confirmed"
    }]
  }
}
```

All optional object properties are sanitized/size-limited before saving; no HTML from OCR is inserted via `innerHTML`, no cloud private key or image blob is saved as text metadata. Context fingerprint changes (PDF/crop/question identity) reset the entire review/crop state. Confidence is explicitly marked **uncalibrated** and is omitted if the model does not supply a bounded numerical value.

### QA and shipping constraints

`qa/ocr-science.spec.mjs` covers negative, negation, decimal, exponent and option differences; invalid candidates and anti-XSS; confidence handling; human warning acknowledgements; OCR-first/second-pass review/revert; figure crop preview and explicit figure acceptance; stale-PDF invalidation; responsive mobile controls.

Review manually with actual Persian science and math PDFs before calling the release complete. Some layouts (two-column options, figures beside prose, mixed RTL/LTR mathematical expressions) are intrinsically ambiguous; operators must compare the final PDF, and all rule-based findings are advisory. On release, verify authenticated Cloudflare OCR, quota/cost/audit, download behavior, screen readers, live security, Rollback, and production publishing. **Do not merge PR #45 or deploy production until final project approval.**
