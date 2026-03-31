ALTER TABLE documents
    ADD COLUMN deleted_at TIMESTAMPTZ NULL;

DROP INDEX IF EXISTS uq_documents_user_source_local;
DROP INDEX IF EXISTS idx_documents_user_source_local;

CREATE UNIQUE INDEX uq_documents_user_source_local
    ON documents(user_id, source_local_id)
    WHERE source_local_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_documents_trash_purge
    ON documents(deleted_at)
    WHERE deleted_at IS NOT NULL;
