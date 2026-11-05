-- One identity resolver.
--
-- Identity grants use nearest-page precedence, then principal specificity.
-- Only the public link is combined with identity by access level. A page No access is a barrier:
-- it suppresses inherited grants above the page and lets a positive grant at or
-- below the page re-open access. A page audience rule replaces the space
-- baseline for that audience; a page audience No access creates the same barrier.
--
-- Public links remain a separate channel: they are combined as a positive level
-- for active pages, never enter the trash scope, and never lower identity.

CREATE OR REPLACE FUNCTION access_level_rank(p_level TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE p_level
               WHEN 'OWNER' THEN 4
               WHEN 'EDIT' THEN 3
               WHEN 'COMMENT' THEN 2
               WHEN 'VIEW' THEN 1
               ELSE 0
           END
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
    v_chain UUID[];
    v_workspace_id UUID;
    v_space_id UUID;
    v_archived TIMESTAMPTZ;
    v_mode TEXT;
    v_everyone TEXT;
    v_member TEXT;
    v_workspace_member BOOLEAN;
    v_audience TEXT;
    v_baseline TEXT;
    v_baseline_depth INTEGER;
    v_audience_effect TEXT;
    v_audience_level TEXT;
    v_audience_depth INTEGER;
    v_deny_depth INTEGER;
    v_deny_kind TEXT;
    v_allow TEXT;
    v_allow_depth INTEGER;
    v_allow_specificity INTEGER;
    v_link TEXT;
    v_result TEXT;

BEGIN
    IF p_scope NOT IN ('ACTIVE', 'TRASH') THEN
        RAISE EXCEPTION 'unknown access scope: %', p_scope;
    END IF;

    IF p_scope = 'TRASH' THEN
        WITH RECURSIVE climb AS (
            SELECT d.id, d.parent_id, (d.deleted_at IS NOT NULL) AS trashed, 0 AS depth
              FROM documents d
             WHERE d.id = p_document_id

            UNION ALL

            SELECT p.id, p.parent_id, (p.deleted_at IS NOT NULL), c.depth + 1
              FROM documents p
              JOIN climb c ON p.id = c.parent_id
             WHERE c.trashed
               AND c.depth < 100
        ), bundle AS (
            SELECT id AS node_id
              FROM climb
             ORDER BY trashed DESC, depth DESC
             LIMIT 1
        ), chain AS (
            SELECT d.id, d.parent_id, 0 AS depth
              FROM documents d
              JOIN bundle b ON d.id = b.node_id

            UNION ALL

            SELECT p.id, p.parent_id, c.depth + 1
              FROM documents p
              JOIN chain c ON p.id = c.parent_id
             WHERE c.depth < 100
        )
        SELECT array_agg(id ORDER BY depth)
          INTO v_chain
          FROM chain;
    ELSE
        WITH RECURSIVE chain AS (
            SELECT d.id, d.parent_id, 0 AS depth
              FROM documents d
             WHERE d.id = p_document_id
               AND d.deleted_at IS NULL

            UNION ALL

            SELECT p.id, p.parent_id, c.depth + 1
              FROM documents p
              JOIN chain c ON p.id = c.parent_id
             WHERE p.deleted_at IS NULL
               AND c.depth < 100
        )
        SELECT array_agg(id ORDER BY depth)
          INTO v_chain
          FROM chain;
    END IF;

    IF v_chain IS NULL OR cardinality(v_chain) = 0 THEN
        RETURN NULL;
    END IF;

    -- Tenant scope is independent of whether the page is in a space. Read it from
    -- the target document, not only from the space branch below.
    SELECT d.workspace_id
      INTO v_workspace_id
      FROM unnest(v_chain) WITH ORDINALITY AS c(id, ord)
      JOIN documents d ON d.id = c.id
     ORDER BY c.ord
     LIMIT 1;

    SELECT s.id,
           s.archived_at,
           s.access_mode,
           s.everyone_access_level,
           sm.access_level,
           (wm.user_id IS NOT NULL)
      INTO v_space_id, v_archived, v_mode, v_everyone, v_member, v_workspace_member
      FROM unnest(v_chain) WITH ORDINALITY AS c(id, ord)
      JOIN documents d ON d.id = c.id
      JOIN spaces s ON s.id = d.space_id
      LEFT JOIN space_members sm
             ON sm.space_id = s.id
            AND sm.user_id = p_user_id
      LEFT JOIN workspace_members wm
             ON wm.workspace_id = s.workspace_id
            AND wm.user_id = p_user_id
     WHERE d.space_id IS NOT NULL
     ORDER BY c.ord
     LIMIT 1;


    -- The audience whose space baseline applies to this caller.
    IF v_member IS NOT NULL THEN
        v_audience := 'SPACE_MEMBERS';
        v_baseline := v_member;
        v_baseline_depth := 1000;
    ELSIF v_mode = 'PUBLIC' AND v_workspace_member THEN
        v_audience := 'SPACE_EVERYONE';
        v_baseline := v_everyone;
        v_baseline_depth := 1000;
    END IF;

    -- A page audience rule replaces the corresponding space baseline. The nearest
    -- rule wins. Its DENY form is a barrier; a nearer ALLOW form suppresses older
    -- audience DENY rules above it.
    IF v_audience IS NOT NULL THEN
        SELECT ag.effect, ag.access_level, c.ord - 1
          INTO v_audience_effect, v_audience_level, v_audience_depth
          FROM unnest(v_chain) WITH ORDINALITY AS c(id, ord)
          JOIN access_grants ag
            ON ag.document_id = c.id
           AND ag.workspace_id = v_workspace_id
           AND ag.audience = v_audience
         ORDER BY c.ord
         LIMIT 1;

        -- SELECT ... INTO with no row clears every target, so only replace the
        -- baseline when this page actually carries an audience rule.
        IF v_audience_effect = 'ALLOW' THEN
            v_baseline := v_audience_level;
            v_baseline_depth := v_audience_depth;
        ELSIF v_audience_effect = 'DENY' THEN
            v_baseline := NULL;
            v_baseline_depth := NULL;
        END IF;
    END IF;

    -- Nearest user/group DENY. Audience DENY is handled from the nearest audience
    -- rule above; an older audience rule must not leak through.
    SELECT d.depth, d.kind
      INTO v_deny_depth, v_deny_kind
      FROM (
            SELECT c.ord - 1 AS depth,
                   CASE
                       WHEN ag.user_id = p_user_id THEN 'USER'
                       ELSE 'GROUP'
                   END AS kind,
                   CASE WHEN ag.user_id = p_user_id THEN 1 ELSE 2 END AS specificity
              FROM unnest(v_chain) WITH ORDINALITY AS c(id, ord)
              JOIN access_grants ag
                ON ag.document_id = c.id
               AND ag.workspace_id = v_workspace_id
              LEFT JOIN workspace_groups wg
                ON wg.id = ag.group_id
               AND wg.workspace_id = v_workspace_id
             WHERE ag.effect = 'DENY'
               AND (ag.user_id = p_user_id
                    OR (wg.id IS NOT NULL
                        AND ag.group_id IN (SELECT gm.group_id
                                             FROM workspace_group_members gm
                                            WHERE gm.user_id = p_user_id)))

            UNION ALL

            SELECT c.ord - 1,
                   'USER',
                   1
              FROM unnest(v_chain) WITH ORDINALITY AS c(id, ord)
              JOIN document_collaborators dc
                ON dc.document_id = c.id
               AND dc.user_id = p_user_id
             WHERE dc.access_level = 'NO_ACCESS'
           ) d
     ORDER BY d.depth, d.specificity
     LIMIT 1;

    -- The nearest audience rule wins over an older audience deny. A user/group deny
    -- at the same or a nearer page still wins by specificity/depth.
    IF v_audience_effect = 'DENY'
       AND (v_deny_depth IS NULL OR v_audience_depth < v_deny_depth) THEN
        v_deny_depth := v_audience_depth;
        v_deny_kind := 'AUDIENCE';
    END IF;

    -- A space baseline is inherited from outside the page chain, so any explicit
    -- user/group deny suppresses it. A nearer page audience ALLOW sits below an
    -- ancestor deny and survives; at the same page the user/group deny is more
    -- specific than the audience rule.
    IF v_deny_kind IN ('USER', 'GROUP')
       AND v_baseline_depth IS NOT NULL
       AND v_baseline_depth >= v_deny_depth THEN
        v_baseline := NULL;
    END IF;

    -- Positive grants. A grant above the barrier is inherited and suppressed; a
    -- grant at the barrier page is allowed only when it is more specific than the
    -- deny (user over group/audience, user/group over audience); grants below it
    -- re-open.
    SELECT a.access_level, a.depth, a.specificity
      INTO v_allow, v_allow_depth, v_allow_specificity
      FROM (
            SELECT ag.access_level, c.ord - 1 AS depth,
                   CASE WHEN ag.user_id = p_user_id THEN 1 ELSE 2 END AS specificity
              FROM unnest(v_chain) WITH ORDINALITY AS c(id, ord)
              JOIN access_grants ag
                ON ag.document_id = c.id
               AND ag.workspace_id = v_workspace_id
              LEFT JOIN workspace_groups wg
                ON wg.id = ag.group_id
               AND wg.workspace_id = v_workspace_id
             WHERE ag.effect = 'ALLOW'
               AND (ag.user_id = p_user_id
                    OR (wg.id IS NOT NULL
                        AND ag.group_id IN (SELECT gm.group_id
                                             FROM workspace_group_members gm
                                            WHERE gm.user_id = p_user_id)))
               AND (v_deny_depth IS NULL
                    OR c.ord - 1 < v_deny_depth
                    OR (c.ord - 1 = v_deny_depth
                        AND (v_deny_kind = 'AUDIENCE' OR ag.user_id = p_user_id)))

            UNION ALL

            SELECT dc.access_level, c.ord - 1, 1
              FROM unnest(v_chain) WITH ORDINALITY AS c(id, ord)
              JOIN document_collaborators dc
                ON dc.document_id = c.id
               AND dc.user_id = p_user_id
             WHERE dc.access_level <> 'NO_ACCESS'
               AND (v_deny_depth IS NULL
                    OR c.ord - 1 < v_deny_depth
                    OR (c.ord - 1 = v_deny_depth
                        AND (v_deny_kind = 'AUDIENCE' OR v_deny_kind = 'GROUP')))

            UNION ALL

            SELECT 'OWNER', c.ord - 1, 0
              FROM unnest(v_chain) WITH ORDINALITY AS c(id, ord)
              JOIN documents d ON d.id = c.id
             WHERE v_space_id IS NULL
               AND d.user_id = p_user_id
               AND (v_deny_depth IS NULL
                    OR c.ord - 1 < v_deny_depth
                    OR (c.ord - 1 = v_deny_depth AND v_deny_kind = 'AUDIENCE'))
           ) a
     ORDER BY a.depth, a.specificity, access_level_rank(a.access_level) DESC
     LIMIT 1;

    v_link := CASE
                  WHEN p_scope = 'ACTIVE' THEN resolve_public_access(p_document_id)
                  ELSE NULL
              END;

    -- A nearer identity grant replaces inherited access, even at a lower level.
    SELECT candidate.access_level
      INTO v_result
      FROM (
            SELECT v_allow AS access_level, v_allow_depth AS depth,
                   v_allow_specificity AS specificity
            UNION ALL
            SELECT v_baseline, v_baseline_depth, 3
           ) candidate
     WHERE candidate.access_level IS NOT NULL
     ORDER BY candidate.depth, candidate.specificity
     LIMIT 1;

    IF access_level_rank(v_link) > access_level_rank(v_result) THEN
        v_result := v_link;
    END IF;

    IF v_result IS NULL AND v_deny_depth IS NOT NULL THEN
        v_result := 'NO_ACCESS';
    END IF;

    IF p_scope = 'TRASH' AND v_archived IS NOT NULL THEN
        RETURN NULL;
    END IF;

    IF p_scope = 'ACTIVE' AND v_archived IS NOT NULL AND v_result <> 'NO_ACCESS' THEN
        RETURN CASE WHEN v_result IS NULL THEN NULL ELSE 'VIEW' END;
    END IF;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION resolve_effective_access(p_user_id UUID, p_document_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT resolve_identity_access(p_user_id, p_document_id, 'ACTIVE')
$$;

CREATE OR REPLACE FUNCTION resolve_trash_access(p_user_id UUID, p_document_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT resolve_identity_access(p_user_id, p_document_id, 'TRASH')
$$;
