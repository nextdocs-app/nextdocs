ALTER TABLE documents
    ADD COLUMN deleted_at TIMESTAMPTZ NULL;

CREATE INDEX idx_documents_trash_purge
    ON documents(deleted_at)
    WHERE deleted_at IS NOT NULL;
