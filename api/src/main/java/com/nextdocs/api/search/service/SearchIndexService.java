package com.nextdocs.api.search.service;

import com.nextdocs.api.search.config.SearchProperties;
import com.nextdocs.api.search.repository.DocumentSearchRepository;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Write path for the search projection.
 *
 * <p>Titles are written by the API after its own metadata commit; content is written
 * from the realtime service's compaction event. One writer per field, and both are
 * upserts, so the reconcile job can safely repeat either.
 */
@Service
@RequiredArgsConstructor
public class SearchIndexService {

    private final SearchProperties properties;
    private final DocumentSearchRepository repository;

    /**
     * Runs in its own transaction: the only caller is an {@code AFTER_COMMIT} listener, whose
     * surrounding transaction has already completed. Joining it would tie this upsert to a
     * finished transaction, so it needs a new one that commits on its own.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void indexTitle(UUID documentId) {
        if (!properties.isEnabled()) {
            return;
        }
        repository.upsertTitle(documentId);
    }

    /**
     * @param text the extracted plain text; empty is a legitimate clear of the body
     * @param producedAt when the realtime service produced the text, used to reject an
     *     older retry that arrives after a newer projection
     * @param indexedAt the document version this projection reflects. The
     *     content-updated request passes the same instant it records as
     *     {@code documents.updated_at}, so the reconcile crawl does not select a document
     *     that this very request just indexed.
     */
    public void indexContent(UUID documentId, String text, boolean truncated, Instant producedAt, Instant indexedAt) {
        if (!properties.isEnabled()) {
            return;
        }
        OffsetDateTime produced = producedAt == null
                ? OffsetDateTime.now(ZoneOffset.UTC)
                : OffsetDateTime.ofInstant(producedAt, ZoneOffset.UTC);
        OffsetDateTime indexed = indexedAt == null
                ? OffsetDateTime.now(ZoneOffset.UTC)
                : OffsetDateTime.ofInstant(indexedAt, ZoneOffset.UTC);
        repository.upsertContent(documentId, text == null ? "" : text, truncated, produced, indexed);
    }
}
