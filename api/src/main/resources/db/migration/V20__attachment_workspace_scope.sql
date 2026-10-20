-- Workspace-scoped attachments, for workspace icon uploads.
--
-- An attachment now belongs to exactly one scope: a document or the workspace.
-- The named CHECK is the single-scope invariant and is written so the future
-- "spaces" migration is mechanical: add space_id, drop this constraint, re-add it
-- over the three columns. Authorization stays out of the schema: a workspace
-- attachment is never handed out anonymously, which the attachment access policy
-- enforces.
ALTER TABLE attachments ALTER COLUMN document_id DROP NOT NULL;
ALTER TABLE attachments ADD COLUMN workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE attachments ADD CONSTRAINT chk_attachments_single_scope
    CHECK (num_nonnulls(document_id, workspace_id) = 1);

-- Document attachments leave this NULL, so a partial index keeps them out entirely.
CREATE INDEX idx_attachments_workspace_id ON attachments(workspace_id) WHERE workspace_id IS NOT NULL;
