ALTER TABLE document_collaborators DROP CONSTRAINT chk_document_collaborators_access_level;

-- Allow collaborators to hold owner access (OWNER) so they can administer sharing,
-- invite/update/remove collaborators, and manage document access.
ALTER TABLE document_collaborators
    ADD CONSTRAINT chk_document_collaborators_access_level
        CHECK (access_level IN ('VIEW', 'COMMENT', 'EDIT', 'OWNER'));
