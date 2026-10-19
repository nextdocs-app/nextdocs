-- Invite-gated registration. Once the bootstrap account exists the instance is closed:
-- every later account must hold an invite bound to its email.
--
-- The invite link carries a single-use token, and accepting it is what proves the
-- registrant controls the invited mailbox: invited users get no second verification
-- email. The raw token exists only in the delivery email — never in an API response,
-- where the admin could copy it and undo the mailbox proof — and only its SHA-256 hash
-- is stored, so a database leak yields no usable links. The link carries the token in
-- the URL fragment, which browsers never send to a server, and the preview and
-- registration calls submit it in POST bodies: it must never appear in a query string,
-- access log or referrer.
--
-- Single-use is the accepted_at claim, made with a conditional UPDATE that also checks
-- the exact token_hash: two simultaneous registrations cannot both consume one invite,
-- and a token rotated by a resend cannot be redeemed by a stale link. There is no
-- revoked_at column: revoking deletes the row. "Pending" everywhere means
-- accepted_at IS NULL, so an expired-but-unclaimed invite stays listed for its
-- retention window and can be revoked or re-issued instead of silently vanishing.
-- A nightly sweep then deletes pending rows long past expiry; accepted rows are kept
-- as the audit trail of how members joined. Re-inviting an email replaces its pending
-- row (in code), which is why the index below is partial.

CREATE TABLE workspace_invites (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID         NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email        VARCHAR(255) NOT NULL,
    role         VARCHAR(16)  NOT NULL,
    token_hash   VARCHAR(255) NOT NULL UNIQUE,
    created_by   UUID         NOT NULL REFERENCES users(id),
    expires_at   TIMESTAMPTZ  NOT NULL,
    accepted_at  TIMESTAMPTZ,
    accepted_by  UUID REFERENCES users(id),
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- One pending invite per address. The service row-locks the workspace while issuing so
-- concurrent batches serialize, and this index makes the invariant hold even without
-- that lock. Accepted rows are outside the partial index, so the audit trail keeps no
-- constraint; the prefix also covers the People view's pending lookup per workspace.
CREATE UNIQUE INDEX uq_workspace_invites_pending_email ON workspace_invites(workspace_id, email) WHERE accepted_at IS NULL;
