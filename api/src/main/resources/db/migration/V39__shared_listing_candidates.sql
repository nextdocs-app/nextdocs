-- Shared listings resolve effective access for every candidate before paginating,
-- so their candidate queries cannot be paged in SQL. They select a narrow set of
-- columns instead of full rows: id, owner, title, parent, sibling key, timestamps,
-- and the workspace audience fields. Covering that projection keeps those scans
-- index-only, so PostgreSQL never visits a heap tuple and never detoasts a page's
-- yjs_state just to decide whether it belongs in the Shared section.
--
-- The partial predicate is the shared-listing subset: active pages outside a space.
-- The key order matches the flat listing's default (updated_at DESC, created_at DESC,
-- id ASC); the roots query filters parent_id IS NULL from the included column.

CREATE INDEX idx_documents_shared_listing_candidates
    ON documents (updated_at DESC, created_at DESC, id)
    INCLUDE (user_id, parent_id, sibling_order_key, title, workspace_id, workspace_access_mode)
    WHERE deleted_at IS NULL AND space_id IS NULL;