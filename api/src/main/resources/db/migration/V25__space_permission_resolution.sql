-- Space-aware permission resolution.
--
-- A space grant is the outermost grant in a document's chain: the document itself
-- and every ancestor are evaluated first, so ownership, collaborator rows (including
-- NO_ACCESS breakpoints), and share links keep beating the space grant. Only when no
-- document-level grant exists does the space that anchors the tree root answer.
--
-- The precedence column replaces the plain depth ordering: document rows keep their
-- depth (0..100, the recursive cap), and the space row is pinned to 1000 so it can
-- never outrank a document grant however deep the chain is.
--
-- Space grants require workspace membership. A PUBLIC space is workspace-public, never
-- internet-public, and resolve_public_access stays untouched: an anonymous share link
-- gains nothing from the space its page happens to sit in.

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
    -- Priority within a single node: explicit collaborator row (NO_ACCESS included)
    -- > ANYONE_WITH_LINK. Unchanged from V13; only the space row is added below.
    document_grants AS (
        SELECT
            ch.depth AS precedence,
            CASE
                WHEN ch.user_id = p_user_id THEN 'OWNER'
                WHEN col.access_level = 'NO_ACCESS' THEN 'NO_ACCESS'
                WHEN col.access_level IS NOT NULL THEN col.access_level
                WHEN ch.general_access_mode = 'ANYONE_WITH_LINK' THEN ch.link_access_level
                ELSE NULL
            END AS resolved_level
          FROM chain ch
          LEFT JOIN document_collaborators col
                 ON col.document_id = ch.id
                AND col.user_id     = p_user_id
    ),
    -- Every reachable chain has at most one space: only a root page may carry one,
    -- so the whole walk costs a single space lookup at most.
    space_grants AS (
        SELECT
            1000 AS precedence,
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
    ),
    grants AS (
        SELECT * FROM document_grants
        UNION ALL
        SELECT * FROM space_grants
    )
    SELECT CASE WHEN resolved_level = 'NO_ACCESS' THEN NULL ELSE resolved_level END
      FROM grants
     WHERE resolved_level IS NOT NULL
     ORDER BY precedence ASC
     LIMIT 1;
$$;

-- Trash scope: same space branch, so a space owner or member keeps restore and
-- purge rights over pages whose owner has left, mirroring their content access.
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
    document_grants AS (
        SELECT
            ch.depth AS precedence,
            CASE
                WHEN ch.user_id = p_user_id THEN 'OWNER'
                WHEN col.access_level = 'NO_ACCESS' THEN 'NO_ACCESS'
                WHEN col.access_level IS NOT NULL THEN col.access_level
                WHEN ch.general_access_mode = 'ANYONE_WITH_LINK' THEN ch.link_access_level
                ELSE NULL
            END AS resolved_level
          FROM chain ch
          LEFT JOIN document_collaborators col
                 ON col.document_id = ch.id
                AND col.user_id     = p_user_id
    ),
    space_grants AS (
        SELECT
            1000 AS precedence,
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
    ),
    grants AS (
        SELECT * FROM document_grants
        UNION ALL
        SELECT * FROM space_grants
    )
    SELECT CASE WHEN resolved_level = 'NO_ACCESS' THEN NULL ELSE resolved_level END
      FROM grants
     WHERE resolved_level IS NOT NULL
     ORDER BY precedence ASC
     LIMIT 1;
$$;

-- A space grant is identity access too, and it sits outside the row it applies to.
-- The callers ask whether a NO_ACCESS breakpoint has a live grant to shadow: without
-- the space branches below, a breakpoint on a page inside a space would look orphaned,
-- so the sharing API could neither write it nor keep it through a prune. A space's own
-- root page has no ancestors, hence the depth-0 seed carrying its space anchor.
CREATE OR REPLACE FUNCTION has_positive_ancestor_grant(p_user_id UUID, p_document_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE ancestors AS (
        -- The document itself, only when a space anchors it: the space grant is external
        -- to the document's own row, exactly like an ancestor's grant is.
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
    )
    SELECT EXISTS (
        SELECT 1
          FROM ancestors a
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
         WHERE a.user_id = p_user_id
            OR (c.access_level IS NOT NULL AND c.access_level <> 'NO_ACCESS')
            OR sm.access_level IS NOT NULL
            OR (s.access_mode = 'PUBLIC' AND wm.user_id IS NOT NULL)
    );
$$;
