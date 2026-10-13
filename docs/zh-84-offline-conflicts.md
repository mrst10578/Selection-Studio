# ZH-84 | Local-only offline staging and history

First isolated client utility in `studio/offline-revisions.js` implements a strictly bounded in-memory queue of local edits with revision and source fingerprint. `reconcile` checks both the server revision and source identity; on conflict, it returns `requiresManualMerge:true`. It **never** overwrites remotely changed data, sends an API request, stores secrets or silently synchronizes edits. `summarizeRevisionTimeline` returns minimal revision metadata without question content. Three regression tests cover quota, immutable copies, stale source conflicts and version ordering.

Next work: connect to operator UI, IndexedDB encrypted/retention policy where available, actual authenticated D1 CAS writes, collaborative presence and conflict resolution dialog, synchronized audit, analytics, access-controlled sharing and multi-device E2E. ZH-84 remains In Progress; no promise of live real-time collaboration or persistent offline sync is made.
