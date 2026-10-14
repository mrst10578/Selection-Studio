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


## 2026-10-15: storage budgets and operator-controlled tombstones

The private asset API adds conservative, explicit usage caps, independent of R2 provider billing limits:

- 24 active attachments and 64 MiB of logical attachment bytes per project.
- 96 active attachments and 256 MiB per authenticated actor across their projects.
- Each upload remains capped at 8 MiB. The D1 mutation **atomically rechecks** all four count/byte caps, rather than trusting a potentially stale preliminary count.
- A full quota returns HTTP 429 `ASSET_QUOTA_EXCEEDED` before the R2 upload in normal cases. Concurrent race losers may have uploaded an R2 object before the atomic D1 guard rejects it; such objects are not served by the API and still require a future reconciliation sweep.
- `DELETE /api/v1/projects/:projectId/assets/:digest?role=<role>` only **tombstones** the project metadata. The object is **not** deleted from R2 synchronously, because a content-addressed object may also be referenced by other projects and concurrent uploads. API returns `physicalCleanupPending:true`.
- Deleting a question PDF that appears in **any saved revision**, including a now-deleted question, is rejected with HTTP 409 `SOURCE_PDF_REFERENCED_BY_QUESTION`. This avoids destroying original evidence and reviewer provenance.
- The bank UI exposes an explicit per-file removal action with a confirmation prompt, and states clearly that physical cleanup has not yet happened. Role ownership and Cloudflare Access signature checks continue to apply.

**Remaining infrastructure work:** R2 is not enabled on the Zh2 Cloudflare account. A scheduled private-R2 orphan/tombstone cleanup with a concurrency-safe grace period, storage reconciliation, durable upload reservation under repeated concurrency, and live billing/limit observation must be added before production. The local Node tests are not a substitute for authenticated preview E2E. No production deployment or merge is authorized.
