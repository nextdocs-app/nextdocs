-- Migration V9: Re-index sibling_order_key for nested documents and order_key for user_document_orders
-- to guarantee unique, valid Base62 fractional index keys, then enforce uniqueness constraints.

WITH base62 AS (
    SELECT '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' AS chars
),
ranked_nested_docs AS (
    SELECT 
        d.id,
        (ROW_NUMBER() OVER (
            PARTITION BY d.parent_id
            ORDER BY d.created_at ASC, d.id ASC
        ) - 1) AS idx
    FROM documents d
    WHERE d.parent_id IS NOT NULL AND d.deleted_at IS NULL
)
UPDATE documents d
SET sibling_order_key = CASE 
    WHEN r.idx < 62 THEN 
        'a' || SUBSTRING(b.chars FROM (r.idx + 1)::integer FOR 1)
    WHEN r.idx < 3908 THEN 
        'b' || SUBSTRING(b.chars FROM ((r.idx - 62) / 62 + 1)::integer FOR 1)
            || SUBSTRING(b.chars FROM ((r.idx - 62) % 62 + 1)::integer FOR 1)
    ELSE 
        'c' || SUBSTRING(b.chars FROM ((r.idx - 3908) / 3844 + 1)::integer FOR 1)
            || SUBSTRING(b.chars FROM (((r.idx - 3908) / 62) % 62 + 1)::integer FOR 1)
            || SUBSTRING(b.chars FROM ((r.idx - 3908) % 62 + 1)::integer FOR 1)
END
FROM ranked_nested_docs r, base62 b
WHERE d.id = r.id;

-- Re-index user_document_orders for all users
WITH base62 AS (
    SELECT '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' AS chars
),
ranked_orders AS (
    SELECT 
        udo.id,
        (ROW_NUMBER() OVER (
            PARTITION BY udo.user_id
            ORDER BY udo.created_at ASC, udo.id ASC
        ) - 1) AS idx
    FROM user_document_orders udo
)
UPDATE user_document_orders udo
SET order_key = CASE 
    WHEN r.idx < 62 THEN 
        'a' || SUBSTRING(b.chars FROM (r.idx + 1)::integer FOR 1)
    WHEN r.idx < 3908 THEN 
        'b' || SUBSTRING(b.chars FROM ((r.idx - 62) / 62 + 1)::integer FOR 1)
            || SUBSTRING(b.chars FROM ((r.idx - 62) % 62 + 1)::integer FOR 1)
    ELSE 
        'c' || SUBSTRING(b.chars FROM ((r.idx - 3908) / 3844 + 1)::integer FOR 1)
            || SUBSTRING(b.chars FROM (((r.idx - 3908) / 62) % 62 + 1)::integer FOR 1)
            || SUBSTRING(b.chars FROM ((r.idx - 3908) % 62 + 1)::integer FOR 1)
END
FROM ranked_orders r, base62 b
WHERE udo.id = r.id;

-- Enforce uniqueness of (parent_id, sibling_order_key) within each parent's child group.
-- Trashed rows are excluded so trashing a document never blocks creating a new
-- sibling with the same key; restore() regenerates a fresh key when needed.
CREATE UNIQUE INDEX idx_documents_parent_sibling_order_key_unique
    ON documents(parent_id, sibling_order_key)
    WHERE parent_id IS NOT NULL AND deleted_at IS NULL;

-- Enforce uniqueness of order_key per user in user_document_orders
CREATE UNIQUE INDEX idx_user_document_orders_user_order_key
    ON user_document_orders(user_id, order_key);
