-- Space archive: hide a space without detaching its pages.
--
-- A space is the optional container of root pages. Deleting the row used to be the
-- only way to retire one, and documents.space_id's ON DELETE SET NULL then detached
-- every page that survived the delete (including pages already in trash). Those pages
-- lost their space grant and came back as Private roots on restore.
--
-- Archive keeps the row and every permission row intact. The permission functions
-- below cap archived-space content at VIEW so the space is readable but frozen, and
-- trash access returns NULL so pages cannot be individually restored or purged while
-- the space is archived. Restore the space first, then manage its trash.
--
-- Hard delete is now legal only when no document row references the space. The FK is
-- RESTRICT as a second line of defence: even a direct SQL delete cannot detach pages.
-- A space that still holds trashed pages is not empty; those pages must be purged
-- permanently before the space row can go.

ALTER TABLE spaces ADD COLUMN archived_at TIMESTAMPTZ;
ALTER TABLE spaces ADD COLUMN archived_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_spaces_archived
    ON spaces(workspace_id, archived_at)
    WHERE archived_at IS NOT NULL;

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_space_id_fkey;
ALTER TABLE documents
    ADD CONSTRAINT fk_documents_space
    FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE RESTRICT;

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
    space_state AS (
        SELECT bool_or(s.archived_at IS NOT NULL) AS archived
          FROM chain ch
          JOIN spaces s ON s.id = ch.space_id
         WHERE ch.space_id IS NOT NULL
    ),
    grants AS (
        SELECT * FROM document_grants
        UNION ALL
        SELECT * FROM space_grants
    )
    SELECT CASE
               WHEN resolved_level = 'NO_ACCESS' THEN NULL
               -- Archive is read-only: keep the caller's read grant but never an edit,
               -- comment, or ownership level. NO_ACCESS above still wins.
               WHEN COALESCE((SELECT archived FROM space_state), FALSE) THEN 'VIEW'
               ELSE resolved_level
           END
      FROM grants
     WHERE resolved_level IS NOT NULL
     ORDER BY precedence ASC
     LIMIT 1;
$$;

-- Trash scope: same space branch, so a space owner or member keeps restore and
-- purge rights over pages whose owner has left, mirroring their content access.
-- An archived space has no trash scope: restore the space first.
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
    space_state AS (
        SELECT bool_or(s.archived_at IS NOT NULL) AS archived
          FROM chain ch
          JOIN spaces s ON s.id = ch.space_id
         WHERE ch.space_id IS NOT NULL
    ),
    grants AS (
        SELECT * FROM document_grants
        UNION ALL
        SELECT * FROM space_grants
    )
    SELECT CASE
               WHEN resolved_level = 'NO_ACCESS' THEN NULL
               WHEN COALESCE((SELECT archived FROM space_state), FALSE) THEN NULL
               ELSE resolved_level
           END
      FROM grants
     WHERE resolved_level IS NOT NULL
     ORDER BY precedence ASC
     LIMIT 1;
$$;

-- Public links: an archived space stays readable through a link, but never editable.
-- The space grant itself is not part of the anonymous channel (V25); this only caps
-- a document-level link grant when the page's chain is anchored in an archived space.
CREATE OR REPLACE FUNCTION resolve_public_access(p_document_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE chain AS (
        SELECT d.id, d.parent_id, d.space_id,
               d.general_access_mode, d.link_access_level, d.link_inherit_blocked,
               0 AS depth
          FROM documents d
         WHERE d.id = p_document_id
           AND d.deleted_at IS NULL

        UNION ALL

        SELECT p.id, p.parent_id, p.space_id,
               p.general_access_mode, p.link_access_level, p.link_inherit_blocked,
               c.depth + 1
          FROM documents p
          JOIN chain c ON p.id = c.parent_id
         WHERE c.depth < 100
           AND p.deleted_at IS NULL
    ),
    space_state AS (
        SELECT bool_or(s.archived_at IS NOT NULL) AS archived
          FROM chain ch
          JOIN spaces s ON s.id = ch.space_id
         WHERE ch.space_id IS NOT NULL
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
    SELECT CASE
               WHEN resolved_level = 'BLOCKED' THEN NULL
               WHEN COALESCE((SELECT archived FROM space_state), FALSE) THEN 'VIEW'
               ELSE resolved_level
           END
      FROM grants
     WHERE resolved_level IS NOT NULL
     ORDER BY depth ASC
     LIMIT 1;
$$;
