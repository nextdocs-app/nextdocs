-- Migration V11: Normalize document ownership to location authority.
-- Invariant: for any nested document, child.user_id == parent.user_id. Ownership of a
-- subtree belongs to the tree's root owner; creators are recorded in created_by and their
-- access flows through ancestor resolution. This backfills existing rows so that documents
-- created under (or moved into) another user's tree stop carrying creator-based ownership,
-- which previously let them bypass the host tree's access changes.

-- Propagate each root's owner down to every descendant.
WITH RECURSIVE tree AS (
    -- Roots keep their owner.
    SELECT d.id, d.user_id AS root_owner
      FROM documents d
     WHERE d.parent_id IS NULL

    UNION ALL

    SELECT d.id, t.root_owner
      FROM documents d
      JOIN tree t ON d.parent_id = t.id
)
UPDATE documents doc
   SET user_id = tree.root_owner
  FROM tree
 WHERE doc.id = tree.id
   AND doc.user_id <> tree.root_owner;
