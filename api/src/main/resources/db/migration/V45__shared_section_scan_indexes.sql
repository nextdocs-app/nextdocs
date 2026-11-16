-- The Shared section starts from the caller's grants instead of scanning every
-- document. These partial indexes keep each branch of that union small: direct and
-- group grants, the workspace-wide audience, and the caller's owned roots.
--
-- The grant indexes are partial on ALLOW because a DENY row never makes a document a
-- Shared candidate. The document indexes exclude trashed rows for the same reason, and
-- the owned-roots index keeps the root predicate out of the heap.

CREATE INDEX idx_access_grants_user_document_allow
    ON access_grants (user_id, document_id)
    WHERE user_id IS NOT NULL AND effect = 'ALLOW';

CREATE INDEX idx_access_grants_group_document_allow
    ON access_grants (group_id, document_id)
    WHERE group_id IS NOT NULL AND effect = 'ALLOW';

CREATE INDEX idx_documents_workspace_audience
    ON documents (workspace_id)
    WHERE deleted_at IS NULL AND workspace_access_mode = 'WORKSPACE_MEMBERS';

CREATE INDEX idx_documents_active_owned_roots
    ON documents (user_id)
    WHERE deleted_at IS NULL AND parent_id IS NULL;
