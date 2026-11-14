package com.nextdocs.api.search.service;

import com.nextdocs.api.search.event.DocumentSearchTitleChangedEvent;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Copies a committed title into the search projection.
 *
 * <p>Runs after commit on purpose: search is derived, so a failed index write must never
 * roll back document creation or a rename. The reconcile job repairs a missed row.
 */
@Component
@RequiredArgsConstructor
public class DocumentSearchTitleListener {

    private static final Logger log = LoggerFactory.getLogger(DocumentSearchTitleListener.class);

    private final SearchIndexService searchIndexService;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onTitleChanged(DocumentSearchTitleChangedEvent event) {
        try {
            searchIndexService.indexTitle(event.documentId());
        } catch (RuntimeException e) {
            // Only the failure type: the document id is not secret, but the driver
            // message can carry values from the row.
            log.warn(
                    "Search title index failed for {}: {}",
                    event.documentId(),
                    e.getClass().getSimpleName());
        }
    }
}
