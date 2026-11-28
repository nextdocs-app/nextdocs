-- The viewer group reads the newest visits of one document, and every open plus every
-- 30 s poll repeats that read. Without this index Postgres sorts the document's whole
-- history on each call; with it the ORDER BY ... LIMIT 50 is an index scan that stops
-- after 50 rows. `id` is the tie-break the reader orders by, so it belongs in the key.
CREATE INDEX idx_document_views_recent ON document_views (document_id, last_viewed_at DESC, id);
