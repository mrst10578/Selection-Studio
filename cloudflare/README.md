# Foundation release gate (ZH-64 through ZH-68)

## ZH-64 Native Pages
Static files are copied into root, /studio and /admin. The advanced-mode Worker uses ASSETS directly; no GitHub Pages origin proxy. Validate paths and PDF loading on a preview deployment.

## ZH-65 CI and rollback
Pull requests build and run regression checks, without deploying production. A main-branch push deploys the validated artifact. Roll back by reverting the bad commit and rerunning the workflow, or promoting a previously validated Pages deployment through the Cloudflare dashboard. **Neither rollback route is automated or tested yet.**

## ZH-66 Access-protected OCR
Configure Cloudflare Access application on /api/* with allowed identities. Set Pages secrets OCR_SERVICE_TOKEN, ACCESS_TEAM_DOMAIN (for example, team.cloudflareaccess.com), ACCESS_AUD (Access application audience). The Pages Worker validates the Access JWT signature using the team's published public keys, issuer, audience and expiry. It never trusts a browser-supplied upstream token. Restrict the upstream OCR Worker to requests authenticated with its separate service token; otherwise the direct upstream hostname may bypass this gateway. Optional OCR_RATE_LIMITER binding provides per-identity rate limiting; **without it there is no application rate limit**. Role defaults to operator for authenticated Access users, so configure Access policy to restrict membership accordingly.

## ZH-67 OCR QA
Automated tests currently cover native routing, health, error handling and fail-closed authentication. Real Persian scans, mathematical formulas, PDF end-to-end, latency, timeout, size limits and upstream token interoperability **still require integration tests with test assets and configured Cloudflare credentials**.

## ZH-68 Security and observability
The legacy studio/operator-auth.js contains client-only demo login and MUST NOT be treated as authorization. Protect the entire operator UI using Cloudflare Access before production use. Audit logs, RBAC claims provisioned by a trusted identity source, rate limiting bindings, AI cost budgets, alerting and recovery drills remain release blockers.

**Production gate: DO NOT mark ZH-64..ZH-68 complete or merge/deploy until real browser tests, Access policy, secret bindings, OCR upstream verification and monitoring have passed.**
