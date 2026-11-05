-- Comment threads move out of the collaborative Yjs document and into PostgreSQL.
--
-- Why: the Yjs relay can only enforce binary document write access, so a
-- COMMENT-level collaborator who may write the `threads` root of a Y.Doc can
-- also write document text. The Yhub migration enforces per-document write
-- permission without inspecting Yjs payloads, which makes comment threads in
-- the Y.Doc untenable. The Y.Doc now carries only document content (including
-- BlockNote comment marks, which are just thread ids); threads, replies,
-- resolutions, and reactions live here and are served over the REST API.
--
-- Legacy migration:
-- Pre-existing experimental comment roots in documents.yjs_state were dropped
-- rather than migrated: with zero production users on an unreleased platform,
-- the risk of data loss cannot justify building throwaway migration scaffolding.
-- The Y.Doc now carries only document content and BlockNote comment marks (thread IDs);
-- discussion state lives in PostgreSQL.
--
-- Body is TEXT rather than JSONB so Hibernate's test schema (H2, Flyway off)
-- and the real Postgres schema agree. The service validates the JSON shape and
-- enforces the size ceiling before writing; nothing queries into the body.
--
-- Author names are snapshotted next to the optional user FK: deleting an
-- account must not erase who wrote a comment, and anonymous link commenters
-- have no user row at all. Resolved-by follows the same rule.

CREATE TABLE comment_threads (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id         UUID         NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    created_by_user_id  UUID         REFERENCES users(id) ON DELETE SET NULL,
    resolved            BOOLEAN      NOT NULL DEFAULT false,
    resolved_by_user_id UUID         REFERENCES users(id) ON DELETE SET NULL,
    resolved_by_user_key UUID,
    resolved_by_name    VARCHAR(255),
    resolved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),

    -- A resolution is either fully absent or carries who/when. The name stays
    -- nullable so a deleted account still resolves through the (nulled) FK.
    CONSTRAINT chk_comment_threads_resolution
        CHECK ((resolved = false
                AND resolved_at IS NULL
                AND resolved_by_user_id IS NULL
                AND resolved_by_user_key IS NULL
                AND resolved_by_name IS NULL)
               OR (resolved = true AND resolved_at IS NOT NULL))
);

-- Threads are loaded per document in creation order; the id breaks timestamp ties
-- so paging/ordering stays deterministic when two clients comment at once.
CREATE INDEX idx_comment_threads_document_created
    ON comment_threads(document_id, created_at, id);

CREATE TABLE comments (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id       UUID         NOT NULL REFERENCES comment_threads(id) ON DELETE CASCADE,
    author_user_id  UUID         REFERENCES users(id) ON DELETE SET NULL,
    -- The author id as recorded at write time, kept after the account is deleted
    -- so a comment keeps its own identity (and avatar grouping) instead of all
    -- deleted authors collapsing into the anonymous bucket.
    author_user_key UUID,
    author_name     VARCHAR(255) NOT NULL,
    body            TEXT         NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- BlockNote renders replies oldest-first; the id tiebreak keeps same-millisecond
-- replies in a stable order.
CREATE INDEX idx_comments_thread_created
    ON comments(thread_id, created_at, id);

CREATE TABLE comment_reactions (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    comment_id  UUID         NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji       VARCHAR(64)  NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),

    -- One reaction per person, emoji, and comment. The table is aggregated by
    -- emoji on read, so duplicate rows would double-count a single user.
    CONSTRAINT uq_comment_reactions_comment_user_emoji UNIQUE (comment_id, user_id, emoji)
);

