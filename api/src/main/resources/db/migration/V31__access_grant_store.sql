-- Canonical page-grant store and workspace scope.
--
-- Membership stays in workspace_members/space_members: those rows carry
-- administration and lifecycle rules, not just content access. Page grants and
-- page audience rules live in access_grants. Public-link settings remain on
-- documents because they have expiry and anonymous-resolution semantics.

CREATE TABLE workspace_groups (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name         VARCHAR(255) NOT NULL,
    external_id  VARCHAR(255),
    source       VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_workspace_group_external UNIQUE (workspace_id, external_id)
);

CREATE INDEX idx_workspace_groups_workspace ON workspace_groups(workspace_id);
CREATE UNIQUE INDEX uq_workspace_group_name_lower
    ON workspace_groups (workspace_id, lower(name));

CREATE TABLE workspace_group_members (
    group_id UUID NOT NULL REFERENCES workspace_groups(id) ON DELETE CASCADE,
    user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, user_id)
);

CREATE INDEX idx_workspace_group_members_user ON workspace_group_members(user_id);

CREATE TABLE access_grants (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id       UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    document_id        UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id            UUID REFERENCES users(id) ON DELETE CASCADE,
    group_id           UUID REFERENCES workspace_groups(id) ON DELETE CASCADE,
    audience           VARCHAR(32),
    effect             VARCHAR(8) NOT NULL,
    access_level       VARCHAR(16),
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_access_grant_principal
        CHECK (num_nonnulls(user_id, group_id, audience) = 1),
    CONSTRAINT chk_access_grant_audience
        CHECK (audience IS NULL
               OR audience IN ('SPACE_MEMBERS', 'SPACE_EVERYONE')),
    CONSTRAINT chk_access_grant_effect
        CHECK ((effect = 'ALLOW'
                AND access_level IN ('VIEW', 'COMMENT', 'EDIT', 'OWNER'))
            OR (effect = 'DENY' AND access_level IS NULL))
);

CREATE UNIQUE INDEX uq_access_grant_user
    ON access_grants(document_id, user_id)
    WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX uq_access_grant_group
    ON access_grants(document_id, group_id)
    WHERE group_id IS NOT NULL;

CREATE UNIQUE INDEX uq_access_grant_audience
    ON access_grants(document_id, audience)
    WHERE audience IS NOT NULL;

CREATE INDEX idx_access_grants_document ON access_grants(document_id);
CREATE INDEX idx_access_grants_workspace_document ON access_grants(workspace_id, document_id);

-- Every document now belongs to exactly one workspace. V19 creates one workspace
-- for a self-hosted instance, so the fallback is deterministic; the space anchor
-- wins when the author is no longer a workspace member.
ALTER TABLE documents
    ADD COLUMN workspace_id UUID REFERENCES workspaces(id);

UPDATE documents d
SET workspace_id = COALESCE(
    (SELECT s.workspace_id FROM spaces s WHERE s.id = d.space_id),
    CASE WHEN (SELECT count(*) FROM workspaces) = 1 THEN (SELECT id FROM workspaces LIMIT 1) END,
    CASE WHEN (SELECT count(*) FROM workspace_members wm WHERE wm.user_id = d.user_id) = 1
         THEN (SELECT wm.workspace_id FROM workspace_members wm WHERE wm.user_id = d.user_id LIMIT 1) END
);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM documents WHERE workspace_id IS NULL) THEN
        RAISE EXCEPTION 'V31 backfill cannot deterministically resolve workspace_id for all documents';
    END IF;
END
$$;

ALTER TABLE documents
    ALTER COLUMN workspace_id SET NOT NULL;

CREATE INDEX idx_documents_workspace ON documents(workspace_id);

-- Backfill page grants. NO_ACCESS is a deny, not a rank; every other level is
-- an allow. This is deliberately one-way: the legacy table stays in place for
-- the Phase 1 dual-write window and the old resolver.
INSERT INTO access_grants (
        workspace_id,
        document_id,
        user_id,
        effect,
        access_level,
        created_by_user_id,
        created_at,
        updated_at)
SELECT d.workspace_id,
       c.document_id,
       c.user_id,
       CASE WHEN c.access_level = 'NO_ACCESS' THEN 'DENY' ELSE 'ALLOW' END,
       CASE WHEN c.access_level = 'NO_ACCESS' THEN NULL ELSE c.access_level END,
       c.granted_by_user_id,
       c.created_at,
       c.updated_at
  FROM document_collaborators c
  JOIN documents d ON d.id = c.document_id
ON CONFLICT DO NOTHING;
