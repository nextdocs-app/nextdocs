-- Full-text search is a derived projection: the Y.Doc in Yhub stays the only content
-- source. This table holds only what `documents` cannot: the capped plain text and the
-- terms Postgres ranks. Title, workspace, ownership and ACL are read from `documents`
-- at query time, so there is no second copy to keep in sync.

-- Accent folding has to apply to the stored tsvector and to the query that ranks it.
-- Pinned to public so the dictionary resolves from every search_path that includes it
-- (Flyway runs each test suite in its own scratch schema).
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;

CREATE TABLE document_search (
    document_id        UUID        PRIMARY KEY
                                   REFERENCES documents(id) ON DELETE CASCADE,
    content            TEXT        NOT NULL,
    -- Whether the extractor clipped the text at its byte cap. Not derivable from the
    -- stored row (a document can legitimately end exactly at the cap), so it is
    -- recorded instead of guessed.
    truncated          BOOLEAN     NOT NULL DEFAULT FALSE,
    -- When the realtime service produced this text, not when the row arrived. A
    -- retried older event must not overwrite a newer projection. NULL until the first
    -- content event: a title-only row has never seen the body.
    source_produced_at TIMESTAMPTZ,
    -- The `documents.updated_at` value this projection reflects. NULL means the body has
    -- never been projected, which is what the reconcile crawl selects. Stamping now()
    -- here from a title write would make a never-crawled document look current, and its
    -- body would then never be indexed.
    indexed_at         TIMESTAMPTZ,
    -- Derived from documents.title and this row's content, and stored because it is an
    -- index: a generated column cannot read the title from another table.
    tsv                TSVECTOR    NOT NULL
);

CREATE INDEX idx_document_search_tsv ON document_search USING GIN (tsv);

-- Cursor for the background crawl. Duplicate upserts are harmless, so no lease is
-- taken; the cursor is what stops a permanently failing document from starving every
-- document ordered after it.
CREATE TABLE search_index_state (
    job_name   TEXT        PRIMARY KEY,
    cursor_id  UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO search_index_state (job_name) VALUES ('reconcile');
