-- Sharing is one grant model: ownership is a page grant, and the effective level is the
-- highest of the independent sources.
--
-- This replaces the two-tier ownership model, where a standalone tree resolved OWNER
-- from documents.user_id with no row, and the space-audience copies in
-- access_grants.audience. Every standalone root now carries a real OWNER grant for its
-- creator (backfilled below), so the creator is demotable and removable like any other
-- full-access collaborator and the "page keeps one owner" guard applies to everyone. A
-- nested page inherits like a space page instead of resolving OWNER from its own creator.
--
-- documents.created_by becomes the UUID creator attribution (the old column was a
-- client-supplied display name); access never reads it. documents.user_id is gone.
--
-- A space is a permission container carrying a workspace-audience grant: its everyone
-- level is the outermost ancestor of the page's workspace audience channel, so a page
-- overrides or blocks it, and a space membership is a separate per-person grant.
-- access_grants.audience is removed with the same change; those rows were stale copies
-- of a baseline the resolver derives from spaces and space_members.
--
-- Resolver, final state:
--   resolve_access_sources(UUID, UUID, TEXT)   -> independent channels, one row each
--   resolve_identity_access(UUID, UUID, TEXT)  -> highest identity channel, NO_ACCESS barred
--   resolve_effective_access(UUID, UUID)       -> identity + the independent public link
--   resolve_trash_access(UUID, UUID)           -> trash scope
--   resolve_public_access(UUID)                -> the public-link channel
--   has_archived_space(UUID)
--   has_positive_identity_grant(UUID, UUID)    -> qualification predicate, not effective access
--   access_level_rank(TEXT)                    -> defined in V33

-- 1. The creator owns the standalone root they created. Roots are the only place
-- the implicit grant lived; space pages carry their access on the space, and nested
-- pages flow from their ancestors.

-- 1a. Repair a Private root that lost its chain. A nested Private page carries no
-- grant of its own: it inherits from its parent. The old detach path could clear
-- parent_id without writing a root grant, leaving a page with no grant, no ancestor
-- and no space that resolved to nobody. A root that already carries a positive
-- identity grant is left alone, so a grant an owner deliberately removed is never
-- resurrected.
INSERT INTO access_grants (workspace_id, document_id, user_id, effect, access_level, created_at)
SELECT d.workspace_id, d.id, d.user_id, 'ALLOW', 'OWNER', d.created_at
  FROM documents d
 WHERE d.space_id IS NULL
   AND d.parent_id IS NULL
   AND d.workspace_id IS NOT NULL
   AND d.user_id IS NOT NULL
   AND d.workspace_access_mode = 'RESTRICTED'
   AND NOT EXISTS (
        SELECT 1 FROM access_grants g
         WHERE g.document_id = d.id
           AND g.effect = 'ALLOW'
           AND (g.user_id IS NOT NULL OR g.group_id IS NOT NULL))
   AND NOT EXISTS (
        SELECT 1 FROM access_grants g
         WHERE g.document_id = d.id AND g.user_id = d.user_id);

-- 1b. Every other standalone root keeps the creator access it had before this
-- migration, even when the root already carries collaborator rows.
INSERT INTO access_grants (workspace_id, document_id, user_id, effect, access_level, created_at)
SELECT d.workspace_id, d.id, d.user_id, 'ALLOW', 'OWNER', d.created_at
  FROM documents d
 WHERE d.space_id IS NULL
   AND d.parent_id IS NULL
   AND d.workspace_id IS NOT NULL
   AND NOT EXISTS (
        SELECT 1 FROM access_grants g
         WHERE g.document_id = d.id AND g.user_id = d.user_id);

-- 2. Creator attribution moves to `created_by`; the old column was a client-supplied
-- display name, so the server's creator identity replaces it outright.
UPDATE documents SET created_by = user_id::text;

ALTER TABLE documents DROP CONSTRAINT documents_user_id_fkey;
DROP INDEX idx_documents_user_created;
DROP INDEX idx_documents_user_updated;
DROP INDEX IF EXISTS idx_documents_active_owned_roots;
ALTER TABLE documents DROP COLUMN user_id;

ALTER TABLE documents
    ALTER COLUMN created_by TYPE UUID USING created_by::uuid,
    ADD CONSTRAINT documents_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

-- V39's covering index listed user_id among its INCLUDEd columns, so dropping the
-- column takes it with it. Drop it explicitly as well: the Shared section no longer
-- reads it, and the end state must not depend on how the column went away.
DROP INDEX IF EXISTS idx_documents_shared_listing_candidates;

-- Every audience row was a duplicate of a baseline the resolver derives from
-- `spaces` and `space_members`; the app is unreleased, so they are dropped rather
-- than migrated.
DELETE FROM access_grants WHERE audience IS NOT NULL;

ALTER TABLE access_grants DROP CONSTRAINT chk_access_grant_audience;
ALTER TABLE access_grants DROP CONSTRAINT chk_access_grant_principal;
DROP INDEX IF EXISTS uq_access_grant_audience;
ALTER TABLE access_grants DROP COLUMN audience;
ALTER TABLE access_grants
    ADD CONSTRAINT chk_access_grant_principal
        CHECK (num_nonnulls(user_id, group_id) = 1);

CREATE OR REPLACE FUNCTION has_positive_identity_grant(p_user_id UUID, p_document_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE chain AS (
        SELECT d.id, d.parent_id, d.space_id, 0 AS depth
          FROM documents d
         WHERE d.id = p_document_id

        UNION ALL

        SELECT p.id, p.parent_id, p.space_id, c.depth + 1
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
           AND g.workspace_id = (SELECT workspace_id FROM documents WHERE id = p_document_id)
           AND (g.user_id = p_user_id OR (
                EXISTS (SELECT 1 FROM workspace_members wm
                         WHERE wm.workspace_id = (SELECT workspace_id FROM documents WHERE id = p_document_id)
                           AND wm.user_id = p_user_id)
                AND gm.user_id = p_user_id))
    ) OR EXISTS (
        -- Space membership is a per-person grant; the everyone audience is not one.
        SELECT 1
          FROM chain c
          JOIN spaces s ON s.id = c.space_id
          JOIN workspace_members wm ON wm.workspace_id = s.workspace_id
          JOIN space_members sm ON sm.space_id = s.id
         WHERE sm.user_id = p_user_id
           AND wm.user_id = p_user_id
    ) OR EXISTS (
        -- A page's workspace audience, unless a page block sits at or below it.
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
    ) OR EXISTS (
        -- A PUBLIC space's everyone audience sits above every page in the chain, so
        -- any page block shadows it.
        SELECT 1
          FROM chain c
          JOIN spaces s ON s.id = c.space_id
          JOIN workspace_members wm ON wm.workspace_id = s.workspace_id
         WHERE s.access_mode = 'PUBLIC'
           AND s.everyone_access_level IS NOT NULL
           AND wm.user_id = p_user_id
           AND NOT EXISTS (
                SELECT 1
                  FROM chain blocked
                  JOIN documents b ON b.id = blocked.id
                 WHERE b.workspace_inherit_blocked
           )
    );
$$;

CREATE OR REPLACE FUNCTION has_archived_space(p_document_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE chain AS (
        SELECT d.id, d.parent_id, d.space_id, 0 AS depth
          FROM documents d
         WHERE d.id = p_document_id

        UNION ALL

        SELECT p.id, p.parent_id, p.space_id, c.depth + 1
          FROM documents p
          JOIN chain c ON p.id = c.parent_id
         WHERE c.depth < 100
    )
    SELECT EXISTS (
        SELECT 1
          FROM chain c
          JOIN spaces s ON s.id = c.space_id
         WHERE s.archived_at IS NOT NULL
    )
$$;

-- One row per applicable source.  `access_level = 'NO_ACCESS'` is only emitted
-- by the page-grant branch: it is the identity barrier.  The other branches
-- either emit a positive level or no row at all (blocked/absent).
CREATE OR REPLACE FUNCTION resolve_access_sources(
        p_user_id UUID,
        p_document_id UUID,
        p_scope TEXT)
RETURNS TABLE (
        channel TEXT,
        source_kind TEXT,
        source_id UUID,
        access_level TEXT)
LANGUAGE plpgsql
STABLE
AS $$
#variable_conflict use_column
BEGIN
    IF p_scope NOT IN ('ACTIVE', 'TRASH') THEN
        RAISE EXCEPTION 'unknown access scope: %', p_scope;
    END IF;

    RETURN QUERY
    WITH RECURSIVE climb AS (
        -- Only used in TRASH: find the topmost contiguous trashed ancestor. The
        -- bundle is then the root of the trash view, as before this migration.
        SELECT d.id, d.parent_id, (d.deleted_at IS NOT NULL) AS trashed, 0 AS depth
          FROM documents d
         WHERE d.id = p_document_id
           AND p_scope = 'TRASH'

        UNION ALL

        SELECT p.id, p.parent_id, (p.deleted_at IS NOT NULL), c.depth + 1
          FROM documents p
          JOIN climb c ON p.id = c.parent_id
         WHERE c.trashed
           AND c.depth < 100
    ),
    bundle AS (
        SELECT id AS node_id
          FROM climb
         ORDER BY trashed DESC, depth DESC
         LIMIT 1
    ),
    start AS (
        SELECT d.id AS node_id
          FROM documents d
         WHERE p_scope = 'ACTIVE'
           AND d.id = p_document_id
           AND d.deleted_at IS NULL

        UNION ALL

        SELECT b.node_id
          FROM bundle b
         WHERE p_scope = 'TRASH'
    ),
    chain AS (
        SELECT d.id, d.parent_id, d.space_id, 0 AS depth
          FROM documents d
          JOIN start s ON s.node_id = d.id

        UNION ALL

        SELECT p.id, p.parent_id, p.space_id, c.depth + 1
          FROM documents p
          JOIN chain c ON p.id = c.parent_id
         WHERE c.depth < 100
           AND (p_scope = 'TRASH' OR p.deleted_at IS NULL)
    ),
    workspace_scope AS (
        SELECT d.workspace_id
          FROM chain c
          JOIN documents d ON d.id = c.id
         ORDER BY c.depth
         LIMIT 1
    ),
    workspace_state AS (
        SELECT EXISTS (
                   SELECT 1
                     FROM workspace_members wm
                    WHERE wm.workspace_id = (SELECT workspace_id FROM workspace_scope)
                      AND wm.user_id = p_user_id
               ) AS is_member
    ),
    page_grant_rows AS (
        SELECT c.depth,
               c.id AS document_id,
               ag.access_level::text AS access_level
          FROM chain c
          JOIN access_grants ag
            ON ag.document_id = c.id
           AND ag.workspace_id = (SELECT workspace_id FROM workspace_scope)
          LEFT JOIN workspace_groups wg
            ON wg.id = ag.group_id
           AND wg.workspace_id = (SELECT workspace_id FROM workspace_scope)
         WHERE ag.effect IN ('ALLOW', 'DENY')
           AND (ag.user_id = p_user_id
                OR ((SELECT is_member FROM workspace_state)
                    AND wg.id IS NOT NULL
                    AND EXISTS (SELECT 1
                                  FROM workspace_group_members gm
                                 WHERE gm.group_id = ag.group_id
                                   AND gm.user_id = p_user_id)))
    ),
    nearest_page_grant AS (
        SELECT MIN(depth) AS depth FROM page_grant_rows
    ),
    page_grant_source AS (
        SELECT 'PAGE_GRANT'::text AS channel,
               'PAGE'::text AS source_kind,
               (SELECT document_id
                  FROM page_grant_rows
                 WHERE depth = (SELECT depth FROM nearest_page_grant)
                 LIMIT 1) AS source_id,
               COALESCE(
                   (SELECT access_level
                      FROM page_grant_rows
                     WHERE depth = (SELECT depth FROM nearest_page_grant)
                       AND access_level IS NOT NULL
                     ORDER BY access_level_rank(access_level) DESC
                     LIMIT 1),
                   'NO_ACCESS'
               ) AS access_level
         WHERE (SELECT depth FROM nearest_page_grant) IS NOT NULL
    ),
    space_source AS (
        SELECT 'SPACE_MEMBER'::text AS channel,
               'SPACE'::text AS source_kind,
               s.id AS source_id,
               sm.access_level::text AS access_level
          FROM chain c
          JOIN documents d ON d.id = c.id
          JOIN spaces s ON s.id = d.space_id
          JOIN space_members sm
            ON sm.space_id = s.id
           AND sm.user_id = p_user_id
         WHERE (SELECT is_member FROM workspace_state)
         ORDER BY c.depth
         LIMIT 1
    ),
    audience_rules AS (
        SELECT c.depth,
               c.id AS document_id,
               CASE
                   WHEN d.workspace_inherit_blocked THEN 'BLOCKED'::text
                   ELSE d.workspace_access_level::text
               END AS access_level
          FROM chain c
          JOIN documents d ON d.id = c.id
         WHERE p_scope = 'ACTIVE'
           AND (SELECT is_member FROM workspace_state)
           AND (d.workspace_inherit_blocked
                OR d.workspace_access_mode = 'WORKSPACE_MEMBERS')
    ),
    nearest_audience AS (
        SELECT depth, document_id, access_level
          FROM audience_rules
         ORDER BY depth
         LIMIT 1
    ),
    space_audience AS (
        SELECT s.id AS source_id,
               s.everyone_access_level::text AS access_level
          FROM chain c
          JOIN documents d ON d.id = c.id
          JOIN spaces s ON s.id = d.space_id
         WHERE p_scope = 'ACTIVE'
           AND (SELECT is_member FROM workspace_state)
           AND s.access_mode = 'PUBLIC'
           AND s.everyone_access_level IS NOT NULL
         ORDER BY c.depth
         LIMIT 1
    ),
    audience_source AS (
        SELECT 'WORKSPACE_AUDIENCE'::text AS channel,
               'PAGE'::text AS source_kind,
               document_id AS source_id,
               access_level
          FROM nearest_audience
         WHERE access_level <> 'BLOCKED'

        UNION ALL

        SELECT 'WORKSPACE_AUDIENCE'::text,
               'SPACE'::text,
               source_id,
               access_level
          FROM space_audience
         WHERE NOT EXISTS (SELECT 1 FROM nearest_audience)
    ),
    link_rules AS (
        SELECT c.depth,
               c.id AS document_id,
               CASE
                   WHEN d.general_access_mode = 'ANYONE_WITH_LINK'
                        AND (d.link_expires_at IS NULL OR d.link_expires_at > now())
                       THEN d.link_access_level::text
                   WHEN d.link_inherit_blocked THEN 'BLOCKED'::text
                   ELSE NULL
               END AS access_level
          FROM chain c
          JOIN documents d ON d.id = c.id
         WHERE p_scope = 'ACTIVE'
           AND (d.general_access_mode = 'ANYONE_WITH_LINK'
                OR d.link_inherit_blocked)
    ),
    nearest_link AS (
        SELECT document_id, access_level
          FROM link_rules
         WHERE access_level IS NOT NULL
         ORDER BY depth
         LIMIT 1
    ),
    link_source AS (
        SELECT 'PUBLIC_LINK'::text AS channel,
               'PAGE'::text AS source_kind,
               document_id AS source_id,
               access_level
          FROM nearest_link
         WHERE access_level <> 'BLOCKED'
    )
    SELECT * FROM page_grant_source
    UNION ALL
    SELECT * FROM space_source
    UNION ALL
    SELECT * FROM audience_source
    UNION ALL
    SELECT * FROM link_source;
END;
$$;

CREATE OR REPLACE FUNCTION resolve_identity_access(
        p_user_id UUID,
        p_document_id UUID,
        p_scope TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_result TEXT;
BEGIN
    IF p_scope NOT IN ('ACTIVE', 'TRASH') THEN
        RAISE EXCEPTION 'unknown access scope: %', p_scope;
    END IF;

    WITH sources AS (
        SELECT *
          FROM resolve_access_sources(p_user_id, p_document_id, p_scope)
         WHERE channel <> 'PUBLIC_LINK'
    )
    SELECT CASE
               WHEN bool_or(access_level = 'NO_ACCESS') THEN 'NO_ACCESS'
               ELSE (SELECT access_level
                       FROM sources
                      WHERE access_level <> 'NO_ACCESS'
                      ORDER BY access_level_rank(access_level) DESC
                      LIMIT 1)
           END
      INTO v_result
      FROM sources;

    IF p_scope = 'TRASH' AND has_archived_space(p_document_id) THEN
        RETURN NULL;
    END IF;

    IF p_scope = 'ACTIVE'
       AND has_archived_space(p_document_id)
       AND v_result IS NOT NULL
       AND v_result <> 'NO_ACCESS' THEN
        RETURN 'VIEW';
    END IF;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION resolve_effective_access(p_user_id UUID, p_document_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_identity TEXT;
    v_link TEXT;
BEGIN
    v_identity := resolve_identity_access(p_user_id, p_document_id, 'ACTIVE');
    v_link := resolve_public_access(p_document_id);

    -- A page-grant NO_ACCESS is a barrier for the identity channels, not a rank
    -- below them. Only the independent live link can still grant the page.
    IF v_identity = 'NO_ACCESS' THEN
        RETURN COALESCE(v_link, 'NO_ACCESS');
    END IF;

    IF v_link IS NULL THEN
        RETURN v_identity;
    END IF;
    IF v_identity IS NULL OR access_level_rank(v_link) > access_level_rank(v_identity) THEN
        RETURN v_link;
    END IF;
    RETURN v_identity;
END;
$$;

CREATE OR REPLACE FUNCTION resolve_trash_access(p_user_id UUID, p_document_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT resolve_identity_access(p_user_id, p_document_id, 'TRASH')
$$;

CREATE OR REPLACE FUNCTION resolve_public_access(p_document_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_result TEXT;
BEGIN
    SELECT access_level
      INTO v_result
      FROM resolve_access_sources(NULL, p_document_id, 'ACTIVE')
     WHERE channel = 'PUBLIC_LINK'
     LIMIT 1;

    IF has_archived_space(p_document_id) AND v_result IS NOT NULL THEN
        RETURN 'VIEW';
    END IF;

    RETURN v_result;
END;
$$;
