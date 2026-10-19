-- Separate who owns an attachment from who may read it.
--
-- Workspace attachments are private by default and become PUBLIC only when the
-- workspace icon adopts them; that icon is branding shown on public share pages.
-- Document attachments keep deriving their audience from the document and must stay
-- PRIVATE here; otherwise the column would suggest an access rule that the document
-- policy ignores.
--
-- This narrows V20's "never handed out anonymously" comment to private workspace
-- attachments only: the icon is readable without a session, everything else still
-- follows the attachment access policy.
ALTER TABLE attachments ADD COLUMN visibility VARCHAR(16) NOT NULL DEFAULT 'PRIVATE';

-- Only the attachment a workspace currently shows is branding. Uploads left over
-- from an abandoned edit must stay private until the sweep deletes them, or an old
-- id would read anonymously despite never becoming an icon.
UPDATE attachments a
SET visibility = 'PUBLIC'
FROM workspaces w
WHERE a.workspace_id = w.id
  AND w.icon_type = 'UPLOAD'
  AND w.icon_value = a.id::text;

ALTER TABLE attachments ADD CONSTRAINT chk_attachments_visibility
    CHECK (visibility IN ('PRIVATE', 'PUBLIC'));

ALTER TABLE attachments ADD CONSTRAINT chk_attachments_document_visibility
    CHECK (document_id IS NULL OR visibility = 'PRIVATE');
