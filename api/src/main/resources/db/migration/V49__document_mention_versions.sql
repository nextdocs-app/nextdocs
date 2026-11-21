-- The high-water mark of the mention set a document's index reflects.
--
-- mention rows alone cannot order two content-updated payloads: a clear deletes every
-- row, so after it there is nothing left to compare a retried older set against. The
-- mark is written in the same transaction as the mention rows, and its upsert locks the
-- row, so two payloads from the same Y.Doc read cannot interleave their writes. A set
-- older than the mark is dropped instead of resurrecting a mention the newer body had
-- removed, and a reindex cannot move the mark backwards.
--
-- Kept apart from document_search so mention ordering survives a disabled search
-- projection; the two indexes are written from one read but are not one projection.

CREATE TABLE document_mention_versions (
    document_id        UUID        PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    source_produced_at TIMESTAMPTZ NOT NULL
);
