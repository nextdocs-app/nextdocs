ALTER TABLE documents
    ADD COLUMN source_local_id VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_documents_user_source_local
    ON documents(user_id, source_local_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_documents_user_source_local
    ON documents(user_id, source_local_id)
    WHERE source_local_id IS NOT NULL;
