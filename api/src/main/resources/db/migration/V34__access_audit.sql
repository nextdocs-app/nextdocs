-- Immutable trail for access mutations.
--
-- Rows reference the workspace, and whoever the mutation was about, but the
-- document/space/user foreign keys are SET NULL on delete: an audit that vanishes
-- with the page it describes is not an audit. Detail is deliberately a short text
-- summary, never a token, email body, or page content.
--
-- The table is append-only: no update endpoint and no delete path outside the
-- workspace/tenant cascade. A future retention job may prune by created_at.

CREATE TABLE access_audit (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    document_id    UUID REFERENCES documents(id) ON DELETE SET NULL,
    space_id       UUID REFERENCES spaces(id) ON DELETE SET NULL,
    actor_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    action         VARCHAR(64) NOT NULL,
    principal_type VARCHAR(32),
    principal_id   UUID,
    detail         VARCHAR(1024),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_access_audit_document ON access_audit(document_id, created_at DESC);
CREATE INDEX idx_access_audit_space ON access_audit(space_id, created_at DESC);
CREATE INDEX idx_access_audit_workspace ON access_audit(workspace_id, created_at DESC);
