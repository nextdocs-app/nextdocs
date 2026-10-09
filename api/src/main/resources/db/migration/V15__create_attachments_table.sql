-- Attachments for image/video/audio/file blocks.
-- Files themselves live in the local storage directory (see app.attachments.storage-path),
-- keyed by <document_id>/<attachment_id>; this table is the metadata + authorization source
-- of truth. ON DELETE CASCADE is a safety net for direct SQL deletes — the application
-- removes attachment rows explicitly so it can also delete the files from disk.

-- IF NOT EXISTS tolerates a database that was created from the earlier V13 incarnation of
-- this file. That file was renamed to V15 because V13 is taken by
-- V13__allow_no_access_collaborator.sql, so such a database has the table without a matching
-- history row for this version. Its DDL was verified byte-identical to the statements below,
-- so the guard only papers over an already-correct table; a database that also applied the
-- later V13 still needs `flyway repair` (or a rebuild). New databases take the plain CREATE
-- path.
CREATE TABLE IF NOT EXISTS attachments (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id  UUID         NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    uploaded_by  UUID         NOT NULL REFERENCES users(id),
    file_name    VARCHAR(255) NOT NULL,
    content_type VARCHAR(255) NOT NULL,
    size_bytes   BIGINT       NOT NULL,
    storage_key  VARCHAR(512) NOT NULL,
    sha256       VARCHAR(64)  NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_attachments_storage_key UNIQUE (storage_key)
);

CREATE INDEX IF NOT EXISTS idx_attachments_document_id ON attachments(document_id);
