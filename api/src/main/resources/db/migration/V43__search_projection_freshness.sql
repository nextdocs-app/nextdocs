-- The crawl needs facts `documents.updated_at` cannot provide. That column is Hibernate's
-- row version, so an icon, cover, move or restore bumps it without touching content, and a
-- content notification that never reaches the API bumps nothing at all.
--
-- content_version: the content notification instant the API has seen. A text-less
-- notification (extraction failed, or an older realtime build) still advances it, while
-- indexed_at records the version actually projected. `indexed_at < content_version` then
-- means "content moved, text did not", without treating metadata writes as content.
--
-- verified_at: when the crawl last confirmed the projection against the Y.Doc. Ageing this
-- out is the only way to find a notification lost in transit or during an API outage;
-- neither of the other two columns moves in that case.
ALTER TABLE document_search
    ADD COLUMN content_version TIMESTAMPTZ,
    ADD COLUMN verified_at TIMESTAMPTZ;

-- Existing content rows were written by a content event, and indexed_at carries the
-- documents.updated_at value that event recorded, so it is the best available evidence for
-- both. Title-only rows stay NULL and are selected on the next crawl.
UPDATE document_search
SET content_version = indexed_at,
    verified_at = indexed_at
WHERE indexed_at IS NOT NULL;