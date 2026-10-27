-- Rotation and reuse detection were binary: the first use revoked the token,
-- and any later use of that value revoked every session for the user. Two
-- tabs refreshing from the same cookie jar look exactly like token theft, so
-- record when a token was rotated and let a brief window re-issue instead of
-- signing the account out everywhere.
--
-- Only rotation stamps this column. Logout and revokeAll leave it NULL so a
-- deliberate revocation can never be mistaken for a benign concurrent refresh.

ALTER TABLE refresh_tokens ADD COLUMN rotated_at TIMESTAMPTZ;
