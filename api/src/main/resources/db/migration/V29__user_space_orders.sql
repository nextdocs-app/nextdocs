-- Personal space ordering.
--
-- A space is ordered per user, like a root page in the Shared section: moving a
-- space around the sidebar changes only the caller's navigation. The table mirrors
-- user_document_orders, and each user keeps one fractional-index key space for the
-- spaces they can see.

CREATE TABLE user_space_orders (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    space_id   UUID        NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    order_key  TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_user_space_orders_user_space UNIQUE (user_id, space_id),
    CONSTRAINT uq_user_space_orders_user_order_key UNIQUE (user_id, order_key)
);

CREATE INDEX idx_user_space_orders_user_order ON user_space_orders(user_id, order_key);
CREATE INDEX idx_user_space_orders_space ON user_space_orders(space_id);
