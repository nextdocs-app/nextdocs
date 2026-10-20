-- Workspace core: one workspace per self-hosted instance, with role-bearing memberships.
--
-- There is deliberately no unique-owner constraint: co-owners are allowed and the
-- "last owner can never be demoted or removed" rule is a service check made under a
-- SELECT ... FOR UPDATE lock on the workspace row (two concurrent demotions would
-- otherwise pass the count check and leave the workspace ownerless).
--
-- icon_type is NULL for no icon, otherwise EMOJI, BUILTIN, UPLOAD, or LINK; icon_value
-- holds the emoji grapheme, builtin slug, attachment id, or URL. The color check mirrors
-- chk_documents_icon_color so the palette is one concept across documents and workspaces
-- (DocumentIconColorPaletteTest pins the three copies together).

CREATE TABLE workspaces (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) NOT NULL,
    icon_type   VARCHAR(16),
    icon_value  VARCHAR(2048),
    icon_color  VARCHAR(32),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT chk_workspaces_icon_color
        CHECK (icon_color IS NULL
               OR (icon_type IS NOT DISTINCT FROM 'BUILTIN'
                   AND icon_color IN ('gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red')))
);

CREATE TABLE workspace_members (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID         NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role         VARCHAR(16)  NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_workspace_member UNIQUE (workspace_id, user_id),
    CONSTRAINT chk_workspace_members_role
        CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER'))
);

CREATE INDEX idx_workspace_members_user ON workspace_members(user_id);

-- Backfill for existing installs: every active user joins one workspace, and the oldest
-- active account owns it. A fresh instance has no users, so nothing is inserted; the first
-- registration creates the workspace and its OWNER membership in code, where the auth flow
-- can also decide that it needs no invite.
--
-- Deactivated accounts stay out: they cannot sign in, and a workspace whose only owner is
-- one of them would be unadministrable. If every existing account is deactivated, fail
-- loudly instead of completing the migration with no active owner.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM users) AND NOT EXISTS (SELECT 1 FROM users WHERE is_active) THEN
        RAISE EXCEPTION 'V19 backfill cannot create a workspace: no active user to own it';
    END IF;
END
$$;

WITH created AS (
    INSERT INTO workspaces (name)
    SELECT 'NextDocs'
    WHERE EXISTS (SELECT 1 FROM users WHERE is_active)
    RETURNING id
)
INSERT INTO workspace_members (workspace_id, user_id, role)
SELECT created.id,
       u.id,
       CASE
           WHEN u.id = (SELECT u2.id FROM users u2 WHERE u2.is_active ORDER BY u2.created_at ASC, u2.id ASC LIMIT 1) THEN 'OWNER'
           ELSE 'MEMBER'
       END
FROM users u
CROSS JOIN created
WHERE u.is_active;
