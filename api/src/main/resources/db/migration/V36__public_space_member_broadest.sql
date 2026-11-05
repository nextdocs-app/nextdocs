-- Explicit space membership replaces the Public space everyone default.
-- Keep nearest-page identity overrides; only the public link raises identity.

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
    v_workspace_member BOOLEAN := FALSE;
    v_space_id UUID;
    v_archived TIMESTAMPTZ;
    v_mode TEXT;
    v_everyone TEXT;
    v_member TEXT;
    v_audience TEXT;
    v_baseline TEXT;
    v_baseline_depth INTEGER;
    v_audience_effect TEXT;
    v_audience_level TEXT;
    v_audience_depth INTEGER;
    v_workspace_allow TEXT;
    v_workspace_depth INTEGER;
    v_workspace_block_depth INTEGER;
    v_deny_depth INTEGER;
    v_deny_kind TEXT;
    v_allow TEXT;
    v_allow_depth INTEGER;
    v_allow_specificity INTEGER;
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

    -- Workspace membership is a property of the workspace, not of the space the
    -- page happens to sit in.
    SELECT EXISTS (SELECT 1
                     FROM workspace_members wm
                    WHERE wm.workspace_id = v_workspace_id
                      AND wm.user_id = p_user_id)
      INTO v_workspace_member;

    SELECT s.id,
           s.archived_at,
           s.access_mode,
           s.everyone_access_level,
           sm.access_level
      INTO v_space_id, v_archived, v_mode, v_everyone, v_member
      FROM unnest(v_chain) WITH ORDINALITY AS c(id, ord)
      JOIN documents d ON d.id = c.id
      JOIN spaces s ON s.id = d.space_id
      LEFT JOIN space_members sm
             ON sm.space_id = s.id
            AND sm.user_id = p_user_id
     WHERE d.space_id IS NOT NULL
     ORDER BY c.ord
     LIMIT 1;

    -- A caller who is no longer a workspace member has no space baseline, even if a
    -- stale membership row exists. Explicit page grants below still apply.
    IF NOT v_workspace_member THEN
        v_member := NULL;
    END IF;


    -- The audience whose space baseline applies to this caller.
    -- When both explicit membership and public everyone default apply, highest level wins.
    IF v_member IS NOT NULL AND (v_mode = 'PUBLIC' AND v_workspace_member) THEN
        IF access_level_rank(v_everyone) > access_level_rank(v_member) THEN
            v_audience := 'SPACE_EVERYONE';
            v_baseline := v_everyone;
        ELSE
            v_audience := 'SPACE_MEMBERS';
            v_baseline := v_member;
        END IF;
        v_baseline_depth := 1000;
    ELSIF v_member IS NOT NULL THEN
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

    -- Workspace audience: a separate positive channel for active pages. A block
    -- shadows grants above it, exactly like the link block; the nearest live grant
    -- below the block is the page's effective "Everyone at workspace" setting.
    IF p_scope = 'ACTIVE' AND v_workspace_member THEN
        SELECT MIN(c.ord - 1)
          INTO v_workspace_block_depth
          FROM unnest(v_chain) WITH ORDINALITY AS c(id, ord)
          JOIN documents d ON d.id = c.id
         WHERE d.workspace_inherit_blocked;

        SELECT d.workspace_access_level, c.ord - 1
          INTO v_workspace_allow, v_workspace_depth
          FROM unnest(v_chain) WITH ORDINALITY AS c(id, ord)
          JOIN documents d ON d.id = c.id
         WHERE d.workspace_access_mode = 'WORKSPACE_MEMBERS'
           AND (v_workspace_block_depth IS NULL OR c.ord - 1 < v_workspace_block_depth)
         ORDER BY c.ord
         LIMIT 1;
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
                    OR (v_workspace_member
                        AND wg.id IS NOT NULL
                        AND ag.group_id IN (SELECT gm.group_id
                                             FROM workspace_group_members gm
                                            WHERE gm.user_id = p_user_id)))

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

    -- Workspace identity is suppressed by a user/group deny too. A space-audience
    -- deny changes only the space baseline and must not touch this channel.
    IF v_deny_kind IN ('USER', 'GROUP') THEN
        v_workspace_allow := NULL;
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
                    OR (v_workspace_member
                        AND wg.id IS NOT NULL
                        AND ag.group_id IN (SELECT gm.group_id
                                             FROM workspace_group_members gm
                                            WHERE gm.user_id = p_user_id)))
               AND (v_deny_depth IS NULL
                    OR c.ord - 1 < v_deny_depth
                    OR (c.ord - 1 = v_deny_depth
                        AND (v_deny_kind = 'AUDIENCE' OR ag.user_id = p_user_id)))


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
     ORDER BY a.depth, access_level_rank(a.access_level) DESC, a.specificity
     LIMIT 1;

    -- Workspace audience does not demote an inherited space member.
    IF v_workspace_allow IS NOT NULL AND v_baseline IS NOT NULL THEN
        IF access_level_rank(v_baseline) > access_level_rank(v_workspace_allow) THEN
            v_workspace_allow := v_baseline;
        END IF;
    END IF;

    -- Resolve inheritance before combining identity with the public link. Nearest
    -- scope wins across depths (depth ASC); at the same depth, highest level wins.
    SELECT candidate.access_level
      INTO v_result
      FROM (
            SELECT v_allow AS access_level, v_allow_depth AS depth,
                   v_allow_specificity AS specificity
            UNION ALL
            SELECT v_baseline, v_baseline_depth, 3
            UNION ALL
            SELECT v_workspace_allow, v_workspace_depth, 4
           ) candidate
     WHERE candidate.access_level IS NOT NULL
     ORDER BY candidate.depth, access_level_rank(candidate.access_level) DESC, candidate.specificity
     LIMIT 1;

    IF v_result IS NULL AND v_deny_depth IS NOT NULL THEN
        v_result := 'NO_ACCESS';
    END IF;

    IF p_scope = 'TRASH' AND v_archived IS NOT NULL THEN
        RETURN NULL;
    END IF;

    IF p_scope = 'ACTIVE' AND v_archived IS NOT NULL AND v_result <> 'NO_ACCESS' THEN
        RETURN 'VIEW';
    END IF;

    RETURN v_result;
END;
$$;
