-- Space content access and explicit page grants.
--
-- Pages inside a space belong to the space container. In a space, user_id is author
-- attribution metadata, NOT an implicit OWNER grant. Content permissions in a space
-- flow directly from space membership (or workspace public access).
--
-- Explicit collaborator rows on a specific page remain authoritative (they can raise
-- access above the space level, lower it, or share with non-space members), NO_ACCESS
-- breakpoints revoke, and public link capabilities bypass the space.
--
-- Standalone pages outside any space retain individual document ownership via user_id.
-- Space archive caps all content access at VIEW and disables trash scope.

CREATE OR REPLACE FUNCTION resolve_effective_access(p_user_id UUID, p_document_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE chain AS (
        SELECT d.id, d.user_id, d.parent_id, d.space_id,
               d.general_access_mode, d.link_access_level,
               0 AS depth
          FROM documents d
         WHERE d.id = p_document_id
           AND d.deleted_at IS NULL

        UNION ALL

        SELECT p.id, p.user_id, p.parent_id, p.space_id,
               p.general_access_mode, p.link_access_level,
               c.depth + 1
          FROM documents p
          JOIN chain c ON p.id = c.parent_id
         WHERE c.depth < 100          -- hard cap; real trees are never this deep
           AND p.deleted_at IS NULL
    ),
    -- A reachable chain holds at most one space anchor, so one row answers both
    -- the caller's space level and the archived state.
    space_state AS (
        SELECT
            s.id AS space_id,
            s.archived_at,
            CASE
                WHEN sm.access_level IS NOT NULL THEN sm.access_level
                WHEN s.access_mode = 'PUBLIC' AND wm.user_id IS NOT NULL
                    THEN s.everyone_access_level
                ELSE NULL
            END AS resolved_level
          FROM chain ch
          JOIN spaces s ON s.id = ch.space_id
          LEFT JOIN space_members sm
                 ON sm.space_id = s.id
                AND sm.user_id  = p_user_id
          LEFT JOIN workspace_members wm
                 ON wm.workspace_id = s.workspace_id
                AND wm.user_id      = p_user_id
         WHERE ch.space_id IS NOT NULL
         LIMIT 1
    ),
    -- In a standalone document (outside any space), user_id confers OWNER.
    -- Inside a space, content belongs to the space; user_id is creator attribution,
    -- NOT an implicit OWNER permission.
    document_grants AS (
        SELECT
            ch.depth AS precedence,
            CASE
                WHEN (SELECT space_id FROM space_state) IS NULL AND ch.user_id = p_user_id THEN 'OWNER'
                WHEN col.access_level = 'NO_ACCESS' THEN 'NO_ACCESS'
                WHEN col.access_level IS NOT NULL THEN col.access_level
                WHEN ch.general_access_mode = 'ANYONE_WITH_LINK' THEN ch.link_access_level
                ELSE NULL
            END AS resolved_level,
            ((SELECT space_id FROM space_state) IS NULL AND ch.user_id = p_user_id OR col.access_level IS NOT NULL) AS identity_grant,
            (col.access_level IS NOT NULL) AS explicit_grant
          FROM chain ch
          LEFT JOIN document_collaborators col
                 ON col.document_id = ch.id
                AND col.user_id     = p_user_id
    ),
    best_document_grant AS (
        SELECT resolved_level, identity_grant, explicit_grant
          FROM document_grants
         WHERE resolved_level IS NOT NULL
         ORDER BY precedence ASC
         LIMIT 1
    ),
    effective_grant AS (
        SELECT
            CASE
                -- An explicit NO_ACCESS row revokes all access.
                WHEN bd.resolved_level = 'NO_ACCESS' THEN NULL
                -- An explicit collaborator row is authoritative: it overrides the space.
                WHEN bd.explicit_grant THEN bd.resolved_level
                -- A public link capability is not membership and is never capped by space.
                WHEN bd.resolved_level IS NOT NULL AND NOT bd.identity_grant THEN bd.resolved_level
                -- Inside a space, content access comes directly from the space.
                WHEN ss.space_id IS NOT NULL THEN ss.resolved_level
                -- Outside any space, standalone document grant governs.
                ELSE bd.resolved_level
            END AS resolved_level,
            ss.archived_at
          FROM (SELECT 1) AS anchor
          LEFT JOIN best_document_grant bd ON TRUE
          LEFT JOIN space_state ss ON TRUE
    )
    SELECT CASE
               WHEN archived_at IS NOT NULL AND resolved_level IS NOT NULL THEN 'VIEW'
               ELSE resolved_level
           END
      FROM effective_grant;
$$;

-- Trash scope mirrors the same rule.
CREATE OR REPLACE FUNCTION resolve_trash_access(p_user_id UUID, p_document_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE
    climb AS (
        SELECT d.id AS node_id,
               d.parent_id,
               (d.deleted_at IS NOT NULL) AS trashed,
               0 AS depth
          FROM documents d
         WHERE d.id = p_document_id

        UNION ALL

        SELECT p.id, p.parent_id,
               (p.deleted_at IS NOT NULL),
               c.depth + 1
          FROM documents p
          JOIN climb c ON p.id = c.parent_id
         WHERE c.trashed
    ),
    bundle_root AS (
        SELECT node_id
          FROM climb
         ORDER BY trashed DESC, depth DESC
         LIMIT 1
    ),
    chain AS (
        SELECT d.id, d.user_id, d.parent_id, d.space_id,
               d.general_access_mode, d.link_access_level,
               0 AS depth
          FROM documents d
          JOIN bundle_root br ON d.id = br.node_id

        UNION ALL

        SELECT p.id, p.user_id, p.parent_id, p.space_id,
               p.general_access_mode, p.link_access_level,
               c.depth + 1
          FROM documents p
          JOIN chain c ON p.id = c.parent_id
         WHERE c.depth < 100
    ),
    space_state AS (
        SELECT
            s.id AS space_id,
            s.archived_at,
            CASE
                WHEN sm.access_level IS NOT NULL THEN sm.access_level
                WHEN s.access_mode = 'PUBLIC' AND wm.user_id IS NOT NULL
                    THEN s.everyone_access_level
                ELSE NULL
            END AS resolved_level
          FROM chain ch
          JOIN spaces s ON s.id = ch.space_id
          LEFT JOIN space_members sm
                 ON sm.space_id = s.id
                AND sm.user_id  = p_user_id
          LEFT JOIN workspace_members wm
                 ON wm.workspace_id = s.workspace_id
                AND wm.user_id      = p_user_id
         WHERE ch.space_id IS NOT NULL
         LIMIT 1
    ),
    document_grants AS (
        SELECT
            ch.depth AS precedence,
            CASE
                WHEN (SELECT space_id FROM space_state) IS NULL AND ch.user_id = p_user_id THEN 'OWNER'
                WHEN col.access_level = 'NO_ACCESS' THEN 'NO_ACCESS'
                WHEN col.access_level IS NOT NULL THEN col.access_level
                WHEN ch.general_access_mode = 'ANYONE_WITH_LINK' THEN ch.link_access_level
                ELSE NULL
            END AS resolved_level,
            ((SELECT space_id FROM space_state) IS NULL AND ch.user_id = p_user_id OR col.access_level IS NOT NULL) AS identity_grant,
            (col.access_level IS NOT NULL) AS explicit_grant
          FROM chain ch
          LEFT JOIN document_collaborators col
                 ON col.document_id = ch.id
                AND col.user_id     = p_user_id
    ),
    best_document_grant AS (
        SELECT resolved_level, identity_grant, explicit_grant
          FROM document_grants
         WHERE resolved_level IS NOT NULL
         ORDER BY precedence ASC
         LIMIT 1
    ),
    effective_grant AS (
        SELECT
            CASE
                WHEN bd.resolved_level = 'NO_ACCESS' THEN NULL
                WHEN bd.explicit_grant THEN bd.resolved_level
                WHEN bd.resolved_level IS NOT NULL AND NOT bd.identity_grant THEN bd.resolved_level
                WHEN ss.space_id IS NOT NULL THEN ss.resolved_level
                ELSE bd.resolved_level
            END AS resolved_level,
            ss.archived_at
          FROM (SELECT 1) AS anchor
          LEFT JOIN best_document_grant bd ON TRUE
          LEFT JOIN space_state ss ON TRUE
    )
    SELECT CASE
               WHEN archived_at IS NOT NULL THEN NULL
               ELSE resolved_level
           END
      FROM effective_grant;
$$;

-- Breakpoint pruning check: a positive ancestor grant.
CREATE OR REPLACE FUNCTION has_positive_ancestor_grant(p_user_id UUID, p_document_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE ancestors AS (
        SELECT d.id, d.user_id, d.parent_id, d.space_id, 0 AS depth
          FROM documents d
         WHERE d.id = p_document_id
           AND d.space_id IS NOT NULL

        UNION ALL

        SELECT p.id, p.user_id, p.parent_id, p.space_id, 1 AS depth
          FROM documents d
          JOIN documents p ON d.parent_id = p.id
         WHERE d.id = p_document_id

        UNION ALL
        SELECT p.id, p.user_id, p.parent_id, p.space_id, a.depth + 1
          FROM documents p
          JOIN ancestors a ON p.id = a.parent_id
         WHERE a.depth < 100
    ),
    has_space AS (
        SELECT EXISTS (SELECT 1 FROM ancestors WHERE space_id IS NOT NULL) AS in_space
    )
    SELECT EXISTS (
        SELECT 1
          FROM ancestors a
          CROSS JOIN has_space hs
          LEFT JOIN document_collaborators c
                 ON c.document_id = a.id
                AND c.user_id     = p_user_id
          LEFT JOIN spaces s ON s.id = a.space_id
          LEFT JOIN space_members sm
                 ON sm.space_id = s.id
                AND sm.user_id  = p_user_id
          LEFT JOIN workspace_members wm
                 ON wm.workspace_id = s.workspace_id
                AND wm.user_id      = p_user_id
         WHERE (NOT hs.in_space AND a.user_id = p_user_id)
            OR (c.access_level IS NOT NULL AND c.access_level <> 'NO_ACCESS')
            OR sm.access_level IS NOT NULL
            OR (s.access_mode = 'PUBLIC' AND wm.user_id IS NOT NULL)
    );
$$;
