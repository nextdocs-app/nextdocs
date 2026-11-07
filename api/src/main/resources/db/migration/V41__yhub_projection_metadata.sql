ALTER TABLE documents
    ADD COLUMN yhub_seeded_at TIMESTAMPTZ,
    ADD COLUMN yhub_projection_cursor BIGINT DEFAULT 0,
    ADD COLUMN yjs_state_yhub_clock BIGINT DEFAULT 0,
    ADD COLUMN yhub_deleted_at TIMESTAMPTZ;

CREATE INDEX idx_documents_yhub_projection ON documents (yhub_projection_cursor);
