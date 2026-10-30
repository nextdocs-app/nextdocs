-- Space-page ordering.
--
-- Pages inside a space are shared content: every member sees the same order, so a
-- space-root page is ordered by documents.sibling_order_key exactly like a nested
-- page. The key is partitioned by space_id, not parent_id, because every space-root
-- page has parent_id NULL.
--
-- Existing space pages get a canonical key from their creation order before the
-- uniqueness constraint and the "space roots have an order key" invariant are added.

WITH base62 AS (
    SELECT '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' AS chars
),
ranked_space_docs AS (
    SELECT
        d.id,
        (ROW_NUMBER() OVER (
            PARTITION BY d.space_id
            ORDER BY d.created_at ASC, d.id ASC
        ) - 1) AS idx
    FROM documents d
    WHERE d.space_id IS NOT NULL AND d.parent_id IS NULL
)
UPDATE documents d
SET sibling_order_key = CASE
    WHEN r.idx < 62 THEN
        'a' || SUBSTRING(b.chars FROM (r.idx + 1)::integer FOR 1)
    WHEN r.idx < 3906 THEN
        'b' || SUBSTRING(b.chars FROM ((r.idx - 62) / 62 + 1)::integer FOR 1)
            || SUBSTRING(b.chars FROM ((r.idx - 62) % 62 + 1)::integer FOR 1)
    ELSE
        'c' || SUBSTRING(b.chars FROM ((r.idx - 3906) / 3844 + 1)::integer FOR 1)
            || SUBSTRING(b.chars FROM (((r.idx - 3906) / 62) % 62 + 1)::integer FOR 1)
            || SUBSTRING(b.chars FROM ((r.idx - 3906) % 62 + 1)::integer FOR 1)
END
FROM ranked_space_docs r, base62 b
WHERE d.id = r.id;

ALTER TABLE documents
    ADD CONSTRAINT chk_documents_space_sibling_order
        CHECK (space_id IS NULL OR sibling_order_key IS NOT NULL);

-- A space page's key is unique among active pages of that space. Trashed rows are
-- excluded so trashing one page never blocks another from taking its position;
-- restore regenerates a fresh key when the retained one collides.
CREATE UNIQUE INDEX idx_documents_space_sibling_order_key_unique
    ON documents(space_id, sibling_order_key)
    WHERE space_id IS NOT NULL AND deleted_at IS NULL;
