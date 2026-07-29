-- Phase 1: Add parent_id (self-referencing FK) and sibling_order_key (fractional index for nested docs).
-- parent_id NULL      → root-level page (no parent; navigation order is in user_document_orders).
-- sibling_order_key   → non-null when parent_id IS NOT NULL; null when parent_id IS NULL.

ALTER TABLE documents
    ADD COLUMN parent_id UUID NULL
        REFERENCES documents(id) ON DELETE SET NULL,
    ADD COLUMN sibling_order_key TEXT NULL;

-- Enforce that nested documents must have a sibling_order_key
ALTER TABLE documents
    ADD CONSTRAINT chk_documents_sibling_order
        CHECK (parent_id IS NULL OR sibling_order_key IS NOT NULL);

-- Backfill sibling_order_key for any existing nested rows
UPDATE documents
SET sibling_order_key = to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
WHERE parent_id IS NOT NULL AND (sibling_order_key IS NULL OR sibling_order_key = '');

-- User navigation placement table for root-level documents (Private and Shared sections)
CREATE TABLE user_document_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    order_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_user_document_orders_user_doc UNIQUE (user_id, document_id)
);

-- Backfill user_document_orders for root-level documents (owner entries)
INSERT INTO user_document_orders (user_id, document_id, order_key, created_at, updated_at)
SELECT d.user_id, d.id,
       to_char(d.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
       d.created_at, d.updated_at
FROM documents d
WHERE d.parent_id IS NULL
ON CONFLICT (user_id, document_id) DO NOTHING;

-- Backfill user_document_orders for collaborators on root-level documents
INSERT INTO user_document_orders (user_id, document_id, order_key, created_at, updated_at)
SELECT c.user_id, c.document_id,
       to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
       c.created_at, c.updated_at
FROM document_collaborators c
JOIN documents d ON d.id = c.document_id
WHERE d.parent_id IS NULL
ON CONFLICT (user_id, document_id) DO NOTHING;

-- Partial index for children of parent X sorted by sibling_order_key
CREATE INDEX idx_documents_parent_sibling_order
    ON documents(parent_id, sibling_order_key)
    WHERE parent_id IS NOT NULL;

-- Index for per-user navigation ordering
CREATE INDEX idx_user_document_orders_user_order
    ON user_document_orders(user_id, order_key);

CREATE INDEX idx_user_document_orders_doc
    ON user_document_orders(document_id);
