-- Migration V13: Allow NO_ACCESS collaborator access level and hierarchical breakpoints.

-- 1. Update constraint to allow NO_ACCESS
ALTER TABLE document_collaborators DROP CONSTRAINT chk_document_collaborators_access_level;
ALTER TABLE document_collaborators
    ADD CONSTRAINT chk_document_collaborators_access_level
        CHECK (access_level IN ('VIEW', 'COMMENT', 'EDIT', 'OWNER', 'NO_ACCESS'));

-- 2. Dedicated function to check if any strict ancestor grants positive user access
-- (ignoring links, ignoring intervening breakpoints, and preserving across trash for restore)
CREATE OR REPLACE FUNCTION has_positive_ancestor_grant(p_user_id UUID, p_document_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE ancestors AS (
        SELECT p.id, p.user_id, p.parent_id, 1 AS depth
          FROM documents d
          JOIN documents p ON d.parent_id = p.id
         WHERE d.id = p_document_id
        UNION ALL
        SELECT p.id, p.user_id, p.parent_id, a.depth + 1
          FROM documents p
          JOIN ancestors a ON p.id = a.parent_id
         WHERE a.depth < 100
    )
    SELECT EXISTS (
        SELECT 1
          FROM ancestors a
          LEFT JOIN document_collaborators c ON c.document_id = a.id AND c.user_id = p_user_id
         WHERE a.user_id = p_user_id
            OR (c.access_level IS NOT NULL AND c.access_level <> 'NO_ACCESS')
    );
$$;

-- 3. Update resolve_effective_access to handle NO_ACCESS breakpoints with strict tie-break
CREATE OR REPLACE FUNCTION resolve_effective_access(p_user_id UUID, p_document_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE chain AS (
        SELECT d.id, d.user_id, d.parent_id,
               d.general_access_mode, d.link_access_level,
               0 AS depth
          FROM documents d
         WHERE d.id = p_document_id
           AND d.deleted_at IS NULL

        UNION ALL

        SELECT p.id, p.user_id, p.parent_id,
               p.general_access_mode, p.link_access_level,
               c.depth + 1
          FROM documents p
          JOIN chain c ON p.id = c.parent_id
         WHERE c.depth < 100
           AND p.deleted_at IS NULL
    ),
    grants AS (
        SELECT
            ch.id          AS doc_id,
            ch.depth,
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
    )
    SELECT CASE WHEN resolved_level = 'NO_ACCESS' THEN NULL ELSE resolved_level END
      FROM grants
     WHERE resolved_level IS NOT NULL
     ORDER BY depth ASC
     LIMIT 1;
$$;

-- 4. Update resolve_trash_access with the same breakpoint resolution logic
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
         WHERE c.depth < 100
    ),
    grants AS (
        SELECT ch.depth,
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
    )
    SELECT CASE WHEN resolved_level = 'NO_ACCESS' THEN NULL ELSE resolved_level END
      FROM grants
     WHERE resolved_level IS NOT NULL
     ORDER BY depth ASC
     LIMIT 1;
$$;
