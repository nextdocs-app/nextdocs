-- Yhub owns document content.
--
-- The pre-Yhub relay stored a snapshot on the document row. That column is gone:
-- browsers write the live document to Yhub, first paint reads Yhub on demand, and
-- the API never keeps a second copy. This branch is unreleased, so the old column
-- is dropped instead of migrated.
ALTER TABLE documents DROP COLUMN yjs_state;

-- Purging a document has to reach Yhub too. Doing that inside the DB transaction
-- would either roll back the delete when Yhub is down or leak content when the
-- process dies between commit and the HTTP call. The outbox is written in the same
-- transaction and drained by a retrying job, so a purge can never be forgotten.
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

-- Completed rows are never pruned: they are the permanent reservation for a document
-- id. A purge leaves a hard tombstone in Yhub, so a document recreated under the same id
-- could never accept content again.
