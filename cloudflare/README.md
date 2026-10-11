# Cloudflare Pages native deployment

The deployment copies `studio/` to the root and `/studio/`, and
`review-console/` to `/admin/`, matching the existing GitHub Pages
layout. `cloudflare/_worker.js` runs in Pages advanced mode and serves
assets via `env.ASSETS.fetch`, **not** GitHub Pages.

## Required GitHub Actions secrets

- `CLOUDFLARE_API_TOKEN`: scoped token permitting Cloudflare Pages deployments
- `CLOUDFLARE_ACCOUNT_ID`: the Zh2 account ID

Cloudflare Pages project: `selection-studio`.
The GitHub integration is not required; Wrangler performs direct uploads.

## Security limitations

The current operator login is client-only and uses demo credentials.
Do not treat it as server authentication. The transitional `/api/ocr`
route still requires a user-supplied OCR token; it is not a secure
session-based replacement. Server-side authentication, authorization,
rate limiting and secret storage are separate release blockers before
opening OCR access to real users.

## Smoke tests after deploy

- `/health` returns `assets: native`
- `/studio/` and `/admin/ocr-studio.html` load
- `/api/ocr` GET -> 405; POST without token -> 401
- Verify PDF rendering, browser storage, and OCR with a permitted test credential
- Confirm no requests to `mrst10578.github.io` are required for static files
