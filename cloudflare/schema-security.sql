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
