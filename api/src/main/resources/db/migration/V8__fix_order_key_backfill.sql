-- Migration V8: Fix order_key backfill for legacy timestamp keys starting with digits or containing non-alphanumeric chars.
-- FractionalIndex keys must start with an ASCII letter ('A'-'Z', 'a'-'z') and contain only [0-9A-Za-z].

-- 1. Fix nested documents sibling_order_key
WITH base62 AS (
    SELECT '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' AS chars
),
invalid_docs AS (
    SELECT id, 
           (ROW_NUMBER() OVER (PARTITION BY parent_id ORDER BY created_at ASC, id ASC) - 1) AS idx
    FROM documents
    WHERE parent_id IS NOT NULL
      AND (sibling_order_key IS NULL
           OR sibling_order_key !~ '^[A-Za-z][0-9A-Za-z]+$'
           OR sibling_order_key ~ '[-:.]')
)
UPDATE documents d
SET sibling_order_key = CASE 
    WHEN invalid_docs.idx < 62 THEN 
        'a' || SUBSTRING(b.chars FROM (invalid_docs.idx + 1)::integer FOR 1)
    WHEN invalid_docs.idx < 3908 THEN 
        'b' || SUBSTRING(b.chars FROM ((invalid_docs.idx - 62) / 62 + 1)::integer FOR 1)
            || SUBSTRING(b.chars FROM ((invalid_docs.idx - 62) % 62 + 1)::integer FOR 1)
    ELSE 
        'c' || SUBSTRING(b.chars FROM ((invalid_docs.idx - 3908) / 3844 + 1)::integer FOR 1)
            || SUBSTRING(b.chars FROM (((invalid_docs.idx - 3908) / 62) % 62 + 1)::integer FOR 1)
            || SUBSTRING(b.chars FROM ((invalid_docs.idx - 3908) % 62 + 1)::integer FOR 1)
END
FROM invalid_docs, base62 b
WHERE d.id = invalid_docs.id;

-- 2. Fix user_document_orders order_key
WITH base62 AS (
    SELECT '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' AS chars
),
invalid_orders AS (
    SELECT id,
           (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at ASC, id ASC) - 1) AS idx
    FROM user_document_orders
    WHERE order_key IS NULL
       OR order_key !~ '^[A-Za-z][0-9A-Za-z]+$'
       OR order_key ~ '[-:.]'
)
UPDATE user_document_orders udo
SET order_key = CASE 
    WHEN invalid_orders.idx < 62 THEN 
        'a' || SUBSTRING(b.chars FROM (invalid_orders.idx + 1)::integer FOR 1)
    WHEN invalid_orders.idx < 3908 THEN 
        'b' || SUBSTRING(b.chars FROM ((invalid_orders.idx - 62) / 62 + 1)::integer FOR 1)
            || SUBSTRING(b.chars FROM ((invalid_orders.idx - 62) % 62 + 1)::integer FOR 1)
    ELSE 
        'c' || SUBSTRING(b.chars FROM ((invalid_orders.idx - 3908) / 3844 + 1)::integer FOR 1)
            || SUBSTRING(b.chars FROM (((invalid_orders.idx - 3908) / 62) % 62 + 1)::integer FOR 1)
            || SUBSTRING(b.chars FROM ((invalid_orders.idx - 3908) % 62 + 1)::integer FOR 1)
END
FROM invalid_orders, base62 b
WHERE udo.id = invalid_orders.id;
