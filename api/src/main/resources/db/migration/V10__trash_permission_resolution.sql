-- Migration V10: Trash-scope permission resolution.
-- resolve_effective_access filters deleted_at IS NULL, so it returns no grants for anything
-- inside a trashed subtree. This function resolves access for trash management instead:
--
--   1. A trashed document belongs to its "trash bundle" - the contiguous run of trashed
--      ancestors above it. Whoever manages the topmost trashed node manages everything
--      inside it, mirroring how a subtree is restored as one unit. Documents grafted into
--      another user's tree therefore follow the host tree's fate instead of surfacing as
--      ghost entries their creator cannot restore or purge.
--   2. Access is then resolved with the standard ancestor walk starting at the bundle root,
--      ignoring deleted_at so pre-trash grants stay valid. Closest grant wins; priority per
--      node: explicit collaborator row > ANYONE_WITH_LINK > none.
--
-- Works for active documents too (bundle root falls back to the document itself).
-- Returns: TEXT ('VIEW' | 'COMMENT' | 'EDIT' | 'OWNER' | NULL)
CREATE OR REPLACE FUNCTION resolve_trash_access(p_user_id UUID, p_document_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE
    -- Step 1: climb the contiguous run of trashed nodes containing the document.
    climb AS (
        SELECT d.id AS node_id,
               d.parent_id,
               (d.deleted_at IS NOT NULL) AS trashed,
               0 AS depth
          FROM documents d
         WHERE d.id = p_document_id

        UNION ALL

        -- Stop at the first non-trashed ancestor: it bounds the bundle.
        SELECT p.id, p.parent_id,
               (p.deleted_at IS NOT NULL),
               c.depth + 1
          FROM documents p
          JOIN climb c ON p.id = c.parent_id
         WHERE c.trashed
    ),
    bundle_root AS (
        -- Topmost trashed node of the run; an active document falls back to itself.
        SELECT node_id
          FROM climb
         ORDER BY trashed DESC, depth DESC
         LIMIT 1
    ),
    -- Step 2: ancestor walk from the bundle root, trashed rows included.
    chain AS (
        SELECT d.id, d.user_id, d.parent_id,
               d.general_access_mode, d.link_access_level,
               0 AS depth
          FROM documents d
          JOIN bundle_root br ON d.id = br.node_id

        UNION ALL

        SELECT p.id, p.user_id, p.parent_id,
               p.general_access_mode, p.link_access_level,
               c.depth + 1
          FROM documents p
          JOIN chain c ON p.id = c.parent_id
         WHERE c.depth < 100          -- hard cap; real trees are never this deep
    ),
    grants AS (
        SELECT ch.depth,
               CASE
                   WHEN ch.user_id = p_user_id THEN 'OWNER'
                   WHEN col.access_level IS NOT NULL THEN col.access_level
                   WHEN ch.general_access_mode = 'ANYONE_WITH_LINK' THEN ch.link_access_level
                   ELSE NULL
               END AS resolved_level
          FROM chain ch
          LEFT JOIN document_collaborators col
                 ON col.document_id = ch.id
                AND col.user_id     = p_user_id
    )
    SELECT resolved_level
      FROM grants
     WHERE resolved_level IS NOT NULL
     ORDER BY depth ASC
     LIMIT 1;
$$;

DROP FUNCTION IF EXISTS resolve_trash_bundle_access(UUID, UUID);
