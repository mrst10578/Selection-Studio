-- Selection Studio security database (ZH-68).
-- Identity and IP addresses are not stored. actor is a truncated SHA-256 of Access sub.
CREATE TABLE IF NOT EXISTS ocr_usage (
 actor TEXT NOT NULL,
 window TEXT NOT NULL CHECK(window IN ('minute','day')),
 bucket INTEGER NOT NULL,
 used INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(actor,window,bucket)
);
CREATE TABLE IF NOT EXISTS security_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 actor TEXT NOT NULL,
 action TEXT NOT NULL,
 result TEXT NOT NULL,
 detail TEXT
);
CREATE INDEX IF NOT EXISTS security_audit_occurred ON security_audit(occurred_at);
-- Operational maintenance: purge old quota entries and logs on an approved cadence.
-- DELETE FROM ocr_usage WHERE (window='minute' AND bucket < unixepoch()/60 - 1440)
--     OR (window='day' AND bucket < unixepoch()/86400 - 31);
-- DELETE FROM security_audit WHERE occurred_at < datetime('now','-30 days');

-- ZH-72: only validated form metadata. PDF blobs and credentials MUST NOT be stored.
CREATE TABLE IF NOT EXISTS studio_drafts (
 actor TEXT NOT NULL,
 project TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision > 0),
 fields_json TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(actor, project)
);
CREATE TABLE IF NOT EXISTS studio_draft_revisions (
 actor TEXT NOT NULL,
 project TEXT NOT NULL,
 revision INTEGER NOT NULL,
 fields_json TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(actor, project, revision)
);
-- Revisions are trimmed to the latest 12 per actor/project on every successful write.


-- ZH-78: durable per-operator OCR batch job control. No image pixels, prompts, emails,
-- JWTs or service tokens are stored in D1. Inputs live only in private R2.
CREATE TABLE IF NOT EXISTS ocr_batch_jobs (
 id TEXT PRIMARY KEY,
 actor TEXT NOT NULL,
 request_key TEXT NOT NULL,
 digest TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','paused','cancelled','completed')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(actor,request_key)
);
CREATE INDEX IF NOT EXISTS ocr_batch_jobs_actor ON ocr_batch_jobs(actor,created_at DESC);
CREATE TABLE IF NOT EXISTS ocr_batch_items (
 id TEXT PRIMARY KEY,
 job_id TEXT NOT NULL REFERENCES ocr_batch_jobs(id) ON DELETE CASCADE,
 ordinal INTEGER NOT NULL,
 client_ref TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('question','answer')),
 asset_key TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'staged' CHECK(status IN ('staged','queued','processing','done','failed','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0 AND attempts<=3),
 lease_until INTEGER,
 error_code TEXT,
 result_json TEXT,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(job_id,client_ref),
 UNIQUE(job_id,ordinal)
);
CREATE INDEX IF NOT EXISTS ocr_batch_items_pending ON ocr_batch_items(job_id,status);
-- The dedicated consumer must share this SECURITY_DB binding and OCR_JOB_ASSETS R2
-- with the authenticated Pages producer. Configure cleanup (e.g., 7 days) before launch.
