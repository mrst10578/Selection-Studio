-- ZH-83 preview additive migration: approvals are scoped to one reviewer grant generation.
-- Apply to existing preview D1 ONLY after saving its Time Travel bookmark.
-- A revoked reviewer's previous approvals MUST remain invalid after re-assignment.
-- Existing approvals are deliberately invalid until their source revision is reviewed again.
ALTER TABLE bank_project_reviewers ADD COLUMN grant_id TEXT NOT NULL DEFAULT '';
ALTER TABLE bank_review_events ADD COLUMN grant_id TEXT NOT NULL DEFAULT '';
