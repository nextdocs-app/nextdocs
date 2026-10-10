-- Per-user attachment storage accounting.
--
-- No IF NOT EXISTS guard here (unlike V15): this table has no earlier incarnation under a
-- different version number, so a plain CREATE is correct and a half-applied migration fails
-- loudly instead of being silently tolerated.
--
-- Uploads reserve bytes here (atomically, before any file hits disk) and release them
-- when the upload fails or the files are deleted, so one EDIT collaborator cannot fill
-- the volume with concurrent uploads. The counter is the fast admission check; the
-- attachments table stays the source of truth for what exists.

CREATE TABLE attachment_usage (
    user_id    UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    used_bytes BIGINT      NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
