# ZH-78 | Cloudflare Queues OCR batch processing

This is a preview-only implementation, developed in PR #45. It is **not deployed to production**, and the pipeline is fail-closed until its bindings, secrets, schema, queue, and consumer have been configured and validated. This issue stays In Progress until final end-to-end authenticated tests.

## Architecture

1. Browser explicitly captures a selected **question** or **answer** PDF crop (up to 6 items in a batch). It prepares WebP locally and asks the operator to **start** the job. No background automatic OCR requests occur merely by viewing the panel.
2. The Pages Worker verifies its existing signed **Cloudflare Access JWT** and email allowlist, then handles authenticated **/api/ocr/jobs** via cloudflare/ocr-batch-api.js. Only the resulting pseudonymous actor ID is passed into the handler.
3. Pages producer writes each image+prompt to a **private R2** bucket, atomically creates the job and item records in its existing D1 SECURITY_DB, and sends Queue messages containing **only jobId and itemId**.
4. A **separate Worker** consumes the messages, with a D1 claim/lease before each call, shared OCR rate limits and audit, and a server-side bearer secret to the existing isolated OCR Worker. It stores bounded transcription results in D1 and deletes consumed R2 inputs. Failed transient requests are retried with bounded backoff. At-least-once delivery and message reordering cannot overwrite a completed item while its D1 lease/state is valid.
5. The panel displays total, completed, failed, waiting and in-progress records; operator can pause, resume, retry failures or cancel. Progress survives closing and reopening the browser because D1 is authoritative. For the last 8 batches the operator may view or copy results. Explicit transfer to the OCR editor is allowed only in the same browser session with the same question identity and PDF crop fingerprint, and still requires all the existing manual review gates.

**Important:** Pause prevents the **start of additional** inference but may allow an already-running upstream request to finish; cancel prevents storing any later result, but **cannot refund inference that has already started**.

## API

All paths are authenticated, no-store, same-origin. No public token or direct browser Cloudflare Queue access.

- POST /api/ocr/jobs
- GET /api/ocr/jobs (last 8 for current Access actor)
- GET /api/ocr/jobs/:uuid
- POST /api/ocr/jobs/:uuid/pause
- POST /api/ocr/jobs/:uuid/resume
- POST /api/ocr/jobs/:uuid/retry
- POST /api/ocr/jobs/:uuid/cancel

Example create request (image abbreviated):

    {
      "requestKey":"valid-random-idempotency-key",
      "items":[
        {"clientRef":"valid-random-client-item-id","kind":"question",
         "image":"data:image/webp;base64,...",
         "prompt":"Transcribe the question faithfully."}
      ]
    }

Responses include counts/progress and **never include the source image or original prompt**. The server rejects malformed references, bad image URLs, excess batch count (max 6), oversized payloads, duplicate clientRefs, foreign job IDs, and missing bindings. Reusing a requestKey with the identical input returns the prior job instead of charging/enqueueing twice; reuse with changed content returns HTTP 409.

### Storage and idempotency

Migration is in cloudflare/schema-security.sql: ocr_batch_jobs and ocr_batch_items. Input bytes are stored **only in** OCR_JOB_ASSETS R2 under private generated keys, deleted after successful processing. Pending/failed job inputs may remain temporarily so they can be retried. The consumer has a daily scheduled **7-day sweep** that cleans up expired job metadata and R2 inputs, including orphaned cancelled batches still described by D1. Do not rely on Cloudflare Queue message retention as the source of truth.

The consumer claims an item through an atomic conditional UPDATE and 180-second lease, with at most **3 attempts**. Automatic retries are for upstream timeout/429/5xx only; permanent failures remain visible for explicit operator retry. Attempts are subject to shared OCR quota including **daily global limit** and per-operator minute/day limits. At-least-once delivery can still duplicate **already-started billable requests** if the Worker dies after inference but before persisting its result; quotas and audit bound this risk, they do not eliminate it.

A failed producer Queue send leaves a visible **staged** item, recoverable through POST /resume (also allowed while running). A manual Resume additionally redispatches **queued** items whose last state update is older than 5 minutes, and **processing** items whose 180-second lease expired with attempts remaining. Expired 3-attempt items become visible failures requiring explicit Retry. Healthy queued items and active processing leases are left untouched. The consumer's D1 conditional claim makes racing duplicate Queue deliveries safe against simultaneous billing. This recovery is operator-triggered only; it does not silently submit more paid OCR work. Explicit cancel prevents new state transitions to a successful OCR result after cancellation. On pause, queued items are staged again; in-flight work may finish.

## Preview deployment checklist (deferred until acceptance)

1. Create a separate preview Cloudflare Queue named selection-studio-ocr-jobs-preview; configure one consumer at a time and a small batch size.
2. Create the **private** R2 bucket named selection-studio-ocr-input-preview. Do not expose a public bucket domain or put credentials in the browser or GitHub. Use an appropriate lifecycle/retention policy.
3. Apply updated cloudflare/schema-security.sql to the **preview D1** before accepting any jobs. The current schema uses IF NOT EXISTS and is additive; keep a backup of existing rows before migration.
4. On the Cloudflare **Pages preview** project bind the same preview D1 as SECURITY_DB, the new R2 bucket as OCR_JOB_ASSETS, and Queue producer as OCR_QUEUE. Production must remain unchanged.
5. Deploy the **separate consumer Worker** only in the preview environment using cloudflare/ocr-queue-consumer.wrangler.jsonc. Bind the same preview D1 and R2, and set the encrypted OCR_SERVICE_TOKEN secret. The source does **not** contain this token. Ensure the isolated OCR upstream accepts the token.
6. Verify preview Access JWT, both failure and success identity paths, D1 usage/audit, real Persian PDFs, Workers AI costs, retry idempotency, reload/resume/cancel, mobile UI, age-based cleanup, and daily/global quota. Review the rollback plan.
7. Deploy/merge the production PR **only with explicit final approval**.

No extra secret is required in the browser; no OCR model response is automatically accepted as canonical question text.

## Known limitations

- UI can hold up to 6 captured images in memory per submission. The server caps the request size and the number of simultaneously active jobs per operator to reduce cost exposure.
- The saved batch transcript is plain text, equations and notes, not a fully annotated bounding-box representation. Existing ZH-76/77 per-question operator review applies after explicit transfer.
- Opening a completed older job on another device allows reading/copying its result but does not silently merge it into a different local PDF session.
- This feature does not guarantee exactly-once paid upstream inference; retries and Worker restarts are at-least-once.
- Unlike regular OCR, batch mode requires the additional Queue and R2 bindings. If they are missing, the service responds with 503 rather than silently processing synchronously.

## Preview infrastructure provisioning (2026-10-15)

- **Provisioned:** Cloudflare Queue `selection-studio-ocr-jobs-preview` on account Zh2, queue ID `c8c0553e357343a4ad534b9e02126272`. Creation was confined to Preview. This Queue has no configured consumer or producer and no OCR messages were sent.
- **Not yet provisioned:** private R2 bucket or any R2/Queue binding. The account's R2 API responds with `10042: Please enable R2 through the Cloudflare Dashboard`. The R2 subscription must be activated by the account owner, with acknowledgement of potential usage-based billing. Do not substitute public buckets, D1 payload storage, or a direct browser OCR proxy.
- **Deployment gate:** GitHub Actions now contains `deploy-preview`, but the configured GitHub repository has empty `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets. The workflow safely skips deployment and leaves Production untouched. Protect the branch Preview with the existing Cloudflare Access wildcard application before any live testing.
- The Queue remains inert until the R2-backed producer and isolated consumer are configured. Never send real OCR messages before R2, Access JWT, audit, cost limits and manual consent are verified.


### 2026-10-15: Preview D1 queue schema applied

The preview D1 `selection-studio-security-preview` initially lacked the OCR batch tables, despite those tables being in `cloudflare/schema-security.sql`. Only that Preview D1 was updated, adding:

- `ocr_batch_jobs` and its `ocr_batch_jobs_actor` index.
- `ocr_batch_items` and its `ocr_batch_items_pending` index.

All four DDL statements succeeded and were verified through `sqlite_master`. Existing review/bank tables were left in place. D1 pre-migration Time Travel bookmark: `00000009-00000002-00005104-ed266fc8de0485a889f6cc71cca516e4`. **No Production D1 change.**

The preview Queue `selection-studio-ocr-jobs-preview` is now explicitly `delivery_paused:true` with zero producers and consumers. The queue must remain paused until a private R2 subscription/bucket exists, both bindings are configured, the isolated Worker is deployed with private secrets, and authenticated cost-controlled acceptance has been approved. Note that paused delivery does not replace disabling new job creation until the full pipeline is configured.


### 2026-10-15: private R2 bucket and Preview Pages bindings provisioned

The account owner enabled R2 on Zh2. Created `selection-studio-ocr-input-preview` (Standard, WEUR) and bound the **Preview-only** Cloudflare Pages `OCR_JOB_ASSETS` binding to it, plus `OCR_QUEUE` to `selection-studio-ocr-jobs-preview`. Added `QUESTION_ASSETS` separately for the question source bucket. Verified the existing Preview D1 binding and variable names/types were preserved and **no Production configuration changed**.

- Public `r2.dev` access is explicitly disabled, and zero custom domains are attached.
- Verified R2 lifecycle rule `Expire OCR input images after 7 days` with prefix `ocr-batches/` and `maxAge:604800` seconds. Incomplete multipart uploads are aborted after 7 days. The question evidence bucket has **no blanket object expiry**.
- The Queue remains `delivery_paused:true`, with zero producers and zero consumers. Binding configuration is not a live consumer or proof that paid OCR works.
- The GitHub PR Preview deployment is still gated on GitHub repository secrets. The isolated OCR batch consumer Worker and its private token have **not** been deployed, and no Queue messages/inference were performed. R2's free allowance is a usage allowance, not a spend hard-stop.


### 2026-10-15: two-sided safety switch (kept OFF for Preview)

Because the Preview D1, private R2 and Queue producer bindings are now configured, mere binding presence must **not** automatically allow users to enqueue jobs while the Queue consumer is missing. Both the Pages producer and the dedicated Queue consumer now enforce the same opt-in guard `OCR_BATCH_ENABLED === 'true'`. It defaults to false when missing. The actual Pages Preview environment variable was explicitly set to `OCR_BATCH_ENABLED=false`, and the checked-in consumer Wrangler config also sets `OCR_BATCH_ENABLED=false`.

- Creating a batch, resuming work or retrying failures responds HTTP 503 `BATCH_DISABLED` **before any new R2 write or Queue send** while the switch is off.
- Reading prior jobs, pausing and cancelling jobs remain possible during a shutdown.
- If a Queue consumer were inadvertently deployed/unpaused, it refuses to infer while the switch is off and retries messages after a long delay instead of silently acknowledging them or calling billable OCR.
- `GET /api/readiness` now reports `ocrBatchExplicitlyEnabled`; its `readyForBatchProducer` indicator is false while this gate is off even if bindings are configured.
- Enable the switch on **both** Pages and the consumer **only after** authentication, live source/provenance tests, budget limits, consumer secret, paused-queue state and an explicit controlled inference test are approved. Queue delivery must be unpaused deliberately as a separate step.


### 2026-10-15: isolated Preview consumer Worker staged in Cloudflare

Deployed the actual isolated module Worker `selection-studio-ocr-batch-consumer-preview` to the Zh2 Cloudflare account (Worker upload acknowledged, then settings fetched back). It is deliberately **non-operational for paid OCR**:

- Module bindings: Preview-only D1 `SECURITY_DB` (`241ef565-d9ea-4d5a-b70e-4c115e0e185d`) and private `OCR_JOB_ASSETS` R2 bucket `selection-studio-ocr-input-preview`.
- The deployed Worker has `OCR_BATCH_ENABLED=false`, `OCR_GLOBAL_DAILY_LIMIT=30`, and **no `OCR_SERVICE_TOKEN` secret**. Missing the secret is intentionally fail-closed.
- Public `workers.dev` subdomain and preview URLs are explicitly disabled; there is no public route. The source is also configured as disabled in `cloudflare/ocr-queue-consumer.wrangler.jsonc`.
- The Queue `selection-studio-ocr-jobs-preview` now has exactly **one Worker consumer**, verified to target the isolated Preview Worker, with batch size 1, max concurrency 1, max 5 Queue retries, 1-second batching window and 60-second retry delay. **Queue delivery remains paused**; no OCR payloads/messages or model calls were submitted.
- An isolated daily cron `0 3 * * *` UTC was installed and checked via GET. It only invokes `cleanupExpiredBatches` on Preview D1/R2 and does not run OCR inference. This complements the private R2 rule expiring source images under `ocr-batches/` after seven days.
- The Pages Preview `OCR_BATCH_ENABLED=false` environment switch remains in place. Even if delivery were accidentally unpaused, the consumer refuses inference until its **separate** operator-controlled flag is enabled. Do not turn on either switch or add the OCR secret until a small, approved live test with explicit cost awareness.
- The full Pages Preview UI/API is **still not deployed** because the GitHub Actions repository lacks a scoped `CLOUDFLARE_API_TOKEN` secret. The Cloudflare linked-app connection cannot create user tokens (permission error 9109). The public GitHub Actions `CLOUDFLARE_ACCOUNT_ID` non-secret variable is now configured.
