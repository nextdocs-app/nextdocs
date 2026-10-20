-- Spaces: optional containers of root pages with their own access model.
--
-- A space is Public (every workspace member gets `everyone_access_level`) or
-- Custom (only listed members), mirroring AppFlowy's space-level permissions.
-- There is deliberately no Private mode: pages without a space already live in
-- the caller's Private/Shared sections, so a third private bucket would duplicate
-- that. There is also no unique-owner constraint: co-owners are allowed and the
-- "last owner can never be demoted or removed" rule is a service check made under
-- a SELECT ... FOR UPDATE lock on the space row (the V19 reasoning for workspaces).
--
-- documents.space_id is nullable with no default and no backfill, which is what
-- keeps existing Private/Shared pages exactly where they are: only a page created
-- in a space or explicitly attached to one carries it. A space anchors at the tree
-- root, so the constraint refuses a space on a nested page; its descendants inherit
-- the space grant through the ordinary parent chain.
--
-- Members reuse the document access vocabulary (VIEW/COMMENT/EDIT/OWNER) so one
-- enum describes content access everywhere; OWNER alone may administer the space.
-- icon_color mirrors chk_documents_icon_color/chk_workspaces_icon_color so the
-- palette stays one concept across documents, workspaces, and spaces
-- (DocumentIconColorPaletteTest pins the copies together).

CREATE TABLE spaces (
    id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id          UUID         NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name                  VARCHAR(255) NOT NULL,
    icon_type             VARCHAR(16),
    icon_value            VARCHAR(2048),
    icon_color            VARCHAR(32),
    access_mode           VARCHAR(16)  NOT NULL DEFAULT 'CUSTOM',
    everyone_access_level VARCHAR(16)  NOT NULL DEFAULT 'VIEW',
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT chk_spaces_access_mode
        CHECK (access_mode IN ('PUBLIC', 'CUSTOM')),
    -- The everyone-else grant can never be ownership: only a membership row may
    -- carry OWNER, otherwise any workspace member would administer a Public space.
    CONSTRAINT chk_spaces_everyone_access_level
        CHECK (everyone_access_level IN ('VIEW', 'COMMENT', 'EDIT')),
    CONSTRAINT chk_spaces_icon_color
        CHECK (icon_color IS NULL
               OR (icon_type IS NOT DISTINCT FROM 'BUILTIN'
                   AND icon_color IN ('gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red')))
);

CREATE INDEX idx_spaces_workspace ON spaces(workspace_id, created_at);

CREATE TABLE space_members (
    id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id           UUID         NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    user_id            UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_level       VARCHAR(16)  NOT NULL,
    granted_by_user_id UUID         REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_space_member UNIQUE (space_id, user_id),
    CONSTRAINT chk_space_members_access_level
        CHECK (access_level IN ('VIEW', 'COMMENT', 'EDIT', 'OWNER'))
);

CREATE INDEX idx_space_members_user ON space_members(user_id);

ALTER TABLE documents
    ADD COLUMN space_id UUID REFERENCES spaces(id) ON DELETE SET NULL;

CREATE INDEX idx_documents_space
    ON documents(space_id)
    WHERE space_id IS NOT NULL;

ALTER TABLE documents
    ADD CONSTRAINT chk_documents_space_root
        CHECK (space_id IS NULL OR parent_id IS NULL);
