-- Mentions are derived indexes, not a second content source.
--
-- A comment body (JSON in comment.body) and a document body (the Yhub Y.Doc) remain
-- the only places a mention lives. These tables exist so notifications can be built
-- without re-parsing either source, and so a future notifier has a durable, deduped
-- "who was mentioned" queue. `notified_at` is null until that worker has handled the
-- row. The one exception is a search reindex, which stamps repaired rows as already
-- notified so a repair crawl cannot re-notify everyone.
--
-- Document mentions are the current set for a document: a live compaction inserts
-- newly mentioned users and deletes removed ones, so a mention edited away before
-- delivery never notifies. A search reindex repairs the same set but stamps
-- notified_at at insert time, because a repair crawl is not an edit.

CREATE TABLE comment_mentions (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    comment_id          UUID         NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    -- Denormalized for the pending-notification query; the comment's thread already
    -- reaches the document, but the notifier would need two joins for every row.
    document_id         UUID         NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    mentioned_user_id   UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mentioned_by_user_id UUID        REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    notified_at         TIMESTAMPTZ,

    -- One row per person per comment. Editing a comment reconciles against this key,
    -- so unchanged mentions keep their notified_at instead of re-notifying.
    CONSTRAINT uq_comment_mentions_comment_user UNIQUE (comment_id, mentioned_user_id)
);

CREATE INDEX idx_comment_mentions_document
    ON comment_mentions(document_id);

-- The future worker scans only pending rows, newest last. A partial index keeps
-- delivered history out of that path.
CREATE INDEX idx_comment_mentions_pending
    ON comment_mentions(mentioned_user_id, created_at)
    WHERE notified_at IS NULL;

CREATE TABLE document_mentions (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id         UUID         NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    mentioned_user_id   UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    notified_at         TIMESTAMPTZ,

    CONSTRAINT uq_document_mentions_document_user UNIQUE (document_id, mentioned_user_id)
);

CREATE INDEX idx_document_mentions_pending
    ON document_mentions(mentioned_user_id, created_at)
    WHERE notified_at IS NULL;
