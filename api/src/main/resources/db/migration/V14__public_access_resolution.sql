-- Migration V14: Public (anonymous) access resolution for share links with inheritance blocking.
--
-- Anyone-with-link grants inherit down the tree, closest-ancestor-wins,
-- mirroring resolve_effective_access but without any user identity:
-- - link_inherit_blocked = FALSE (default): RESTRICTED means "no own link, inherit through".
-- - link_inherit_blocked = TRUE: this document and its descendants resolve to
--   NULL (private) even when an ancestor holds ANYONE_WITH_LINK, until a
--   descendant sets its own ANYONE_WITH_LINK (closest-ancestor-wins override
--   re-enables the subtree below it).
-- - Trashed documents and trashed ancestors stop resolution.

ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS link_inherit_blocked BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION resolve_public_access(p_document_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE chain AS (
        SELECT d.id, d.parent_id,
               d.general_access_mode, d.link_access_level, d.link_inherit_blocked,
               0 AS depth
          FROM documents d
         WHERE d.id = p_document_id
           AND d.deleted_at IS NULL

        UNION ALL

        SELECT p.id, p.parent_id,
               p.general_access_mode, p.link_access_level, p.link_inherit_blocked,
               c.depth + 1
          FROM documents p
          JOIN chain c ON p.id = c.parent_id
         WHERE c.depth < 100
           AND p.deleted_at IS NULL
    ),
    grants AS (
        SELECT
            ch.depth,
            CASE
                -- Own link wins over an own block: closest-ancestor-wins
                -- override re-enables the subtree below it.
                WHEN ch.general_access_mode = 'ANYONE_WITH_LINK' THEN ch.link_access_level
                WHEN ch.link_inherit_blocked THEN 'BLOCKED'
                ELSE NULL
            END AS resolved_level
          FROM chain ch
    )
    SELECT CASE WHEN resolved_level = 'BLOCKED' THEN NULL ELSE resolved_level END
      FROM grants
     WHERE resolved_level IS NOT NULL
     ORDER BY depth ASC
     LIMIT 1;
$$;
