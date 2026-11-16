-- Personal ordering for the Shared section.
--
-- The Shared section is a per-user view over grants. Its order belongs to the
-- viewer and must not share a key space with Private: a space-root page has a
-- shared position inside its space and a private one in the viewer's Shared
-- list, and reordering one must never rewrite the other. A separate table is
-- the cheapest way to guarantee that isolation.
--
-- Rows that belong to the Shared section today are moved here: collaborator
-- rows, owned roots with an audience, and space pages. Owner rows for private
-- roots stay in user_document_orders so an unshare returns the page to its old
-- Private position; the copy here gives the same page a stable Shared position
-- for the window in which it is shared.

CREATE TABLE user_shared_document_orders (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id UUID        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    order_key   TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_user_shared_orders_user_doc UNIQUE (user_id, document_id),
    CONSTRAINT uq_user_shared_orders_user_order_key UNIQUE (user_id, order_key)
);

-- (user_id, order_key) is already covered by the unique constraint on the same
-- columns, so only the document lookup needs its own index.
CREATE INDEX idx_user_shared_orders_doc ON user_shared_document_orders(document_id);

INSERT INTO user_shared_document_orders (user_id, document_id, order_key, created_at, updated_at)
SELECT udo.user_id, udo.document_id, udo.order_key, udo.created_at, udo.updated_at
FROM user_document_orders udo
JOIN documents d ON d.id = udo.document_id
WHERE d.space_id IS NOT NULL
   OR udo.user_id <> d.user_id
   OR d.workspace_access_mode <> 'RESTRICTED'
   OR EXISTS (SELECT 1 FROM access_grants g WHERE g.document_id = d.id AND g.effect = 'ALLOW');

-- The private table now holds only the caller's own navigation. A collaborator
-- row was never part of Private and would otherwise leak into MIN/MAX queries.
DELETE FROM user_document_orders udo
USING documents d
WHERE d.id = udo.document_id
  AND udo.user_id <> d.user_id;
