-- Identity cleanup. Everything an account needs to be named, and nothing it cannot use.
--
-- avatar_url is dropped: nothing in the app can set a provider picture (there is no OAuth
-- flow), so the column only existed to make the avatar URL getter branch. The uploaded
-- photo is now the only avatar, and its bytes live beside attachments
-- (<storage-path>/<userId>/<avatarId>).
--
-- avatar_id is the photo's version and does three jobs at once, which is why there is no
-- separate storage key or digest column: it is the second half of the storage key, the ?v=
-- fingerprint in the avatar URL (a replacement is a new URL, so the image can be cached
-- hard), and the strong ETag a cached copy revalidates against.
--
-- email_verified is dropped: there is no verification flow, and the only writer set it true
-- on invite acceptance — the invite itself is the proof of the mailbox, so every row would
-- carry a flag that cannot be meaningfully false.
--
-- oauth_accounts is dropped with its entity and token converter: no controller, service or
-- writer references it, and it required an encryption key that was never documented. OAuth
-- gets designed around the real flow when it lands, instead of inheriting a guessed table.
--
-- password_hash becomes NOT NULL with it: every account now has a password, so the
-- null-for-OAuth-only branch disappears from the entity and the login path.
ALTER TABLE users
    ADD COLUMN avatar_id UUID,
    ADD COLUMN avatar_content_type VARCHAR(64),
    DROP COLUMN avatar_url,
    DROP COLUMN email_verified;

ALTER TABLE users
    ALTER COLUMN password_hash SET NOT NULL;

-- The two avatar columns are written together or not at all.
ALTER TABLE users
    ADD CONSTRAINT ck_users_avatar_complete
    CHECK ((avatar_id IS NULL) = (avatar_content_type IS NULL));

DROP TABLE IF EXISTS oauth_accounts;
