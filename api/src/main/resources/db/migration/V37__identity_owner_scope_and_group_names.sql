-- Authoritative catalog of access functions (post-migration final state):
--   resolve_public_access(UUID)                          -> defined in V33
--   access_level_rank(TEXT)                              -> defined in V33
--   resolve_trash_access(UUID, UUID)                     -> defined in V33
--   resolve_effective_access(UUID, UUID)                 -> defined in V35
--   resolve_identity_access(UUID, UUID, TEXT)            -> defined in V36
--   has_positive_ancestor_grant(UUID, UUID)              -> defined in V35
--   has_positive_identity_grant(UUID, UUID)              -> defined in V37

-- A space-page author is attribution, not a content grant. Only standalone page
-- chains use document.user_id as an ownership source in the roster identity gate.
CREATE OR REPLACE FUNCTION has_positive_identity_grant(p_user_id UUID, p_document_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE chain AS (
        SELECT d.id, d.parent_id, d.space_id, d.user_id, 0 AS depth
          FROM documents d
         WHERE d.id = p_document_id

        UNION ALL

        SELECT p.id, p.parent_id, p.space_id, p.user_id, c.depth + 1
          FROM documents p
          JOIN chain c ON p.id = c.parent_id
         WHERE c.depth < 100
    )
    SELECT EXISTS (
        SELECT 1
          FROM chain c
          JOIN access_grants g ON g.document_id = c.id
          LEFT JOIN workspace_groups wg
            ON wg.id = g.group_id
           AND wg.workspace_id = (SELECT workspace_id FROM documents WHERE id = p_document_id)
          LEFT JOIN workspace_group_members gm ON gm.group_id = wg.id
         WHERE g.effect = 'ALLOW'
           AND (g.user_id = p_user_id OR (
                EXISTS (SELECT 1 FROM workspace_members wm
                         WHERE wm.workspace_id = (SELECT workspace_id FROM documents WHERE id = p_document_id)
                           AND wm.user_id = p_user_id)
                AND gm.user_id = p_user_id))
    ) OR EXISTS (
        SELECT 1
          FROM chain c
          JOIN spaces s ON s.id = c.space_id
          JOIN workspace_members wm ON wm.workspace_id = s.workspace_id
         WHERE wm.user_id = p_user_id
           AND (
                EXISTS (SELECT 1 FROM space_members sm WHERE sm.space_id = s.id AND sm.user_id = p_user_id)
                OR (s.access_mode = 'PUBLIC' AND s.everyone_access_level IS NOT NULL)
           )
    ) OR EXISTS (
        SELECT 1
          FROM chain c
         WHERE c.user_id = p_user_id
           AND NOT EXISTS (SELECT 1 FROM chain space_page WHERE space_page.space_id IS NOT NULL)
    ) OR EXISTS (
        SELECT 1
          FROM chain c
          JOIN documents d ON d.id = c.id
         WHERE d.workspace_access_mode = 'WORKSPACE_MEMBERS'
           AND d.workspace_access_level IN ('VIEW', 'COMMENT', 'EDIT')
           AND EXISTS (SELECT 1 FROM workspace_members wm
                        WHERE wm.workspace_id = d.workspace_id
                          AND wm.user_id = p_user_id)
           AND NOT EXISTS (
                SELECT 1
                  FROM chain blocked
                  JOIN documents b ON b.id = blocked.id
                 WHERE b.workspace_inherit_blocked
                   AND blocked.depth <= c.depth
           )
    );
$$;
