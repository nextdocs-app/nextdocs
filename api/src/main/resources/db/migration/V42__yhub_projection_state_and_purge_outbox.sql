-- Yhub projection state and purge outbox.
--
-- The projection cursor used to live on every document (documents.yhub_projection_cursor),
-- which cannot express "this row is the high-water mark": a single skipped document
-- replayed the whole stream, and two API instances each kept their own copy in memory.
-- One row now holds the cursor plus a lease, so a single writer advances it and the
-- position survives a restart.
--
-- Purging a document has to reach Yhub too. Doing that inside the DB transaction would
-- either roll back the delete when Yhub is down or leak content when the process dies
-- between commit and the HTTP call. The outbox is written in the same transaction and
-- drained by a retrying job, so a purge can never be forgotten.

CREATE TABLE yhub_projection_state (
    id              SMALLINT    PRIMARY KEY,
    cursor          BIGINT      NOT NULL DEFAULT 0,
    lease_owner     UUID,
    lease_expires_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_yhub_projection_state_singleton CHECK (id = 1)
);

-- Seed from the per-document high-water mark so an upgrade does not replay the stream.
INSERT INTO yhub_projection_state (id, cursor)
SELECT 1, COALESCE(MAX(yhub_projection_cursor), 0) FROM documents;

CREATE TABLE yhub_purge_outbox (
    id              UUID         PRIMARY KEY,
    document_id     UUID         NOT NULL,
    attempts        INTEGER      NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_error      VARCHAR(500),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at    TIMESTAMPTZ
);

-- The drain query only ever looks at pending rows; a partial index keeps it small.
CREATE INDEX idx_yhub_purge_outbox_pending
    ON yhub_purge_outbox (next_attempt_at)
    WHERE completed_at IS NULL;

ALTER TABLE documents DROP COLUMN yhub_projection_cursor;
