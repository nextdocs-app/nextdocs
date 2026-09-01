-- Computes the effective access_level a given user has on a given document
-- by walking the parent_id chain (closest-ancestor-wins).
-- Returns NULL if no explicit grant is found anywhere in the chain.
-- Accepts: p_user_id UUID, p_document_id UUID
-- Returns: TEXT  ('VIEW' | 'COMMENT' | 'EDIT' | 'OWNER' | NULL)
CREATE OR REPLACE FUNCTION resolve_effective_access(p_user_id UUID, p_document_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE chain AS (
        -- Seed: the document itself
        SELECT d.id, d.user_id, d.parent_id,
               d.general_access_mode, d.link_access_level,
               0 AS depth
          FROM documents d
         WHERE d.id = p_document_id
           AND d.deleted_at IS NULL

        UNION ALL

        -- Walk up to parent
        SELECT p.id, p.user_id, p.parent_id,
               p.general_access_mode, p.link_access_level,
               c.depth + 1
          FROM documents p
          JOIN chain c ON p.id = c.parent_id
         WHERE c.depth < 100          -- hard cap; real trees are never this deep
           AND p.deleted_at IS NULL
    ),
    -- For each node in the chain, find the best explicit grant for this user.
    -- Priority within a single node: explicit collaborator row > ANYONE_WITH_LINK.
    grants AS (
        SELECT
            ch.id          AS doc_id,
            ch.depth,
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
    -- Pick the shallowest (closest) ancestor that actually has a grant.
    SELECT resolved_level
      FROM grants
     WHERE resolved_level IS NOT NULL
     ORDER BY depth ASC
     LIMIT 1;
$$;
