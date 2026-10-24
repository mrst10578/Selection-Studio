# ZH-80 | JSON Content-Type validation audit (Preview only)

Observed on development branch `feat/cloudflare-native-deployment` at `3549473` (2026-10-21): `cloudflare/question-api-v1.js` accepts media types using `startsWith('application/json')`. This also matches `application/jsonp`, which is not JSON. Recommended narrow change: compare the media type before `;` with `application/json` (case-insensitive), preserving charset parameters.

Regression expectations for `POST /api/v1/projects`: `application/jsonp` -> 400 `JSON_REQUIRED`; `application/json; charset=utf-8` with invalid JSON -> 400 `INVALID_JSON`; the latter proves the media type was accepted and JSON parsing ran. Confirm no DB mutation for either request. Run `node --test tests/question-api-content-type.test.mjs` and the existing question API tests before preview rollout.

This is a proposal only; do not merge or deploy to production. No OCR, billing, access-policy, or secret changes are required.
