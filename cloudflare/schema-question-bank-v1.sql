-- ZH-80 | ADDITIVE preview-only D1 migration. Run after schema-security.sql.
-- All data remains private to the hashed, validated Cloudflare Access actor.
CREATE TABLE IF NOT EXISTS bank_projects (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS bank_projects_actor ON bank_projects(actor,deleted_at,updated_at DESC);
CREATE TABLE IF NOT EXISTS bank_questions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES bank_projects(id),
  actor TEXT NOT NULL,
  content_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state='draft'),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS bank_questions_scope ON bank_questions(actor,project_id,deleted_at,updated_at DESC);
CREATE TABLE IF NOT EXISTS bank_question_revisions (
  question_id TEXT NOT NULL REFERENCES bank_questions(id),
  revision INTEGER NOT NULL,
  actor TEXT NOT NULL,
  content_json TEXT NOT NULL,
  state TEXT NOT NULL,
  deleted_at TEXT,
  happened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(question_id,revision)
);
CREATE TRIGGER IF NOT EXISTS bank_question_insert_history AFTER INSERT ON bank_questions
BEGIN
 INSERT INTO bank_question_revisions(question_id,revision,actor,content_json,state,deleted_at)
 VALUES(new.id,new.revision,new.actor,new.content_json,new.state,new.deleted_at);
END;
CREATE TRIGGER IF NOT EXISTS bank_question_update_history AFTER UPDATE OF revision ON bank_questions
BEGIN
 INSERT INTO bank_question_revisions(question_id,revision,actor,content_json,state,deleted_at)
 VALUES(new.id,new.revision,new.actor,new.content_json,new.state,new.deleted_at);
END;
