-- Singleton row that serializes bootstrap registration. An empty database has no
-- workspace row to lock, so two concurrent first registrations would each pass the
-- "no members yet" check and both bootstrap a workspace and an owner. Registration
-- takes a pessimistic write lock on this row and re-checks initialization under it;
-- the loser falls through to the invite path. The CHECK keeps the table at exactly one
-- row by construction, and the row itself carries no state.
CREATE TABLE instance_lock (
    id SMALLINT PRIMARY KEY CHECK (id = 1)
);

INSERT INTO instance_lock (id) VALUES (1);
