-- ZH-81 | additive preview-only asset ownership registry
CREATE TABLE IF NOT EXISTS bank_assets (
 project_id TEXT NOT NULL REFERENCES bank_projects(id),
 actor TEXT NOT NULL,
 digest TEXT NOT NULL CHECK(length(digest)=64),
 mime TEXT NOT NULL CHECK(mime IN ('application/pdf','image/png','image/jpeg','image/webp','application/json')),
 role TEXT NOT NULL CHECK(role IN ('question_pdf','answer_pdf','figure','export')),
 object_key TEXT NOT NULL,
 byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 16 AND 8388608),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 deleted_at TEXT,
 PRIMARY KEY(project_id,digest,role)
);
CREATE INDEX IF NOT EXISTS bank_assets_actor ON bank_assets(actor,project_id,deleted_at,created_at DESC);
