# Selection Studio Worker

Cloudflare Worker API boundary for Selection Studio.

## Responsibilities
- Accept complete operator batches plus question/answer crop previews.
- Store pending/review/completed/rejected batch state and source previews in R2.
- Protect intake and admin routes with separate secrets.
- Expose the Review Console queue, batch, source, save, lock, reject, restore, and publish endpoints.
- Publish only approved questions that pass the same quality gates to GitHub canonical data.
- Rebuild `runtime/catalog.json` in the same Git commit as canonical question/exam updates.

## Required bindings and secrets
- R2 binding: `BATCH_BUCKET`
- Secret: `SUBMIT_KEY`
- Secret: `ADMIN_KEY`
- Secret: `GITHUB_TOKEN`
- Variable: `GITHUB_REPO` in `owner/repo` form
- Variable: `GITHUB_BRANCH`
- Variable: `ALLOWED_ORIGINS` as a comma-separated allowlist

The GitHub token needs read/write Contents permission for the canonical repository. Keep the admin and submit keys different.

## API
- `POST /studio/intake` — multipart batch + crop files; submit-key auth.
- `GET /studio/admin/list?status=pending|completed|rejected`
- `GET /studio/admin/batch?status=...&id=...`
- `GET /studio/admin/source?batch_id=...&question_id=...&kind=question|answer`
- `POST /studio/admin/save`
- `POST /studio/admin/publish`
- `POST /studio/admin/reject`
- `POST /studio/admin/restore`
- `POST /studio/admin/lock`
- `POST /studio/admin/unlock`

Admin routes use `x-testbank-admin-key`. Intake uses `x-testbank-submit-key`.

## Deployment boundary
This directory is deployment-ready source only. Do not deploy it until the rebuild verification goal and a separate deployment authorization are complete.
