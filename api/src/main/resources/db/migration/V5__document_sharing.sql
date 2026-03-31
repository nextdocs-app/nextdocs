ALTER TABLE documents
    ADD COLUMN general_access_mode VARCHAR(32) NOT NULL DEFAULT 'RESTRICTED',
    ADD COLUMN link_access_level VARCHAR(16) NOT NULL DEFAULT 'VIEW';

ALTER TABLE documents
    ADD CONSTRAINT chk_documents_general_access_mode
        CHECK (general_access_mode IN ('RESTRICTED', 'ANYONE_WITH_LINK')),
    ADD CONSTRAINT chk_documents_link_access_level
        CHECK (link_access_level IN ('VIEW', 'COMMENT', 'EDIT'));

CREATE TABLE document_collaborators (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_level VARCHAR(16) NOT NULL,
    granted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_document_collaborators_doc_user UNIQUE (document_id, user_id),
    CONSTRAINT chk_document_collaborators_access_level
        CHECK (access_level IN ('VIEW', 'COMMENT', 'EDIT'))
);

CREATE INDEX idx_document_collaborators_user
    ON document_collaborators(user_id, updated_at DESC);

CREATE INDEX idx_document_collaborators_doc
    ON document_collaborators(document_id);
