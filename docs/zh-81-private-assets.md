# ZH-81 | R2 private asset storage, initial isolated helper

`cloudflare/private-assets.js` implements a constrained, dependency-free server-only R2 helper for private PDF, PNG, JPEG, WebP and small JSON assets.

- Each asset key is namespaced under a **trusted authenticated actor hash**, never a browser-provided path. SHA-256 fingerprints address content and allow repeat uploads to reuse the same private object.
- Validates declared MIME against magic bytes (or strictly parsed JSON). Caps inputs at 8 MiB; no direct public bucket links, public tokens, or external CDN.
- `putPrivateAsset`, `readPrivateAsset`, and `privateAssetKey` are **not directly exposed as HTTP APIs**. These functions fail closed when the R2 binding is missing and require server-side identity before use.
- `tests/private-assets.test.mjs` has three mocked-R2 unit tests: content validation, cross-actor isolation, deduplication and missing-binding failure.

**Not yet operational:** In Cloudflare Zh St #2, account R2 lists return code 10042 (R2 activation required), and private bucket is not provisioned. The helper has not been wired to the authenticated user UI or D1 asset registry; no binding, retention automation, lifecycle, backup, download authorization API or migration has been deployed. Upstream question records remain unchanged. Real PDF and storage billing verification are final acceptance tasks.

This partial source implementation does not justify marking ZH-81 Completed. Production must remain untouched.

## 2026-10-14 infrastructure recheck

The connected Zh2 Cloudflare account still returns API error `10042` (R2 has not been enabled) when listing R2 buckets. The Queues list succeeds but is empty. Pages Preview environment exposes the `SECURITY_DB` binding and the Access/OCR configuration key *names*, but no R2 bucket binding. The private file upload and OCR batch code therefore remain intentionally fail-closed rather than falling back to a public bucket or paid provider. Production bindings and deploy configuration were not changed.
