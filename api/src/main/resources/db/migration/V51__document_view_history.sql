CREATE TABLE document_views (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_viewed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uk_document_views_document_user UNIQUE (document_id, user_id)
);
