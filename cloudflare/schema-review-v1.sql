-- ZH-83 | additive, preview-only independent reviewer assignments / evidence
-- Store reviewer email HASH only, never Cloudflare token or email plaintext.
CREATE TABLE IF NOT EXISTS bank_project_reviewers (
  project_id TEXT NOT NULL REFERENCES bank_projects(id),
  reviewer_email_hash TEXT NOT NULL CHECK(length(reviewer_email_hash)=64),
  assigned_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(project_id,reviewer_email_hash)
);
CREATE TABLE IF NOT EXISTS bank_review_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES bank_projects(id),
  question_id TEXT NOT NULL REFERENCES bank_questions(id),
  source_revision INTEGER NOT NULL CHECK(source_revision>=1),
  reviewer_actor TEXT NOT NULL,
  reviewer_email_hash TEXT NOT NULL CHECK(length(reviewer_email_hash)=64),
  decision TEXT NOT NULL CHECK(decision IN ('approve','reject')),
  checklist_json TEXT NOT NULL,
  source_digest TEXT NOT NULL CHECK(length(source_digest)=64),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS bank_review_events_question ON bank_review_events(question_id,source_revision,created_at DESC);
CREATE INDEX IF NOT EXISTS bank_review_events_project ON bank_review_events(project_id,created_at DESC);
