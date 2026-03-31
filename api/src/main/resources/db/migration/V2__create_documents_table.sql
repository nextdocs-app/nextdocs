CREATE TABLE documents (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       VARCHAR(255) NOT NULL,
    yjs_state   BYTEA        NOT NULL,
    created_by  VARCHAR(255),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_documents_user_created ON documents(user_id, created_at DESC);
CREATE INDEX idx_documents_user_updated ON documents(user_id, updated_at DESC);
