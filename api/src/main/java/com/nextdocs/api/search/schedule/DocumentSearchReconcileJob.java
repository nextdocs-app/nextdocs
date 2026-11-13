package com.nextdocs.api.search.schedule;

import com.nextdocs.api.realtime.client.YhubClient;
import com.nextdocs.api.search.config.SearchProperties;
import com.nextdocs.api.search.repository.DocumentSearchRepository;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Fills and repairs the search projection.
 *
 * <p>New documents get a title-only row from the write path, and content arrives from the
 * realtime compaction event. This job covers what those two cannot: documents that
 * predate search, an event lost while the API was down, and a failed index write.
 *
 * <p>Freshness is not read from {@code documents.updated_at}: that column is the row
 * version, so a metadata save moves it without changing content. A projection is selected
 * when it was never verified, when a text-less content notification outran its text, or
 * when its last verification is older than the configured window. The last case is the
 * only way to recover a notification that never arrived, because such a loss moves no
 * timestamp of its own.
 *
 * <p>Work is selected from Postgres but extracted in realtime, because only the realtime
 * service has a Yjs runtime. The cursor rotates through the stale set, so a document that
 * fails every time does not starve the ones ordered after it.
 */
@Component
@RequiredArgsConstructor
public class DocumentSearchReconcileJob {

    private static final Logger log = LoggerFactory.getLogger(DocumentSearchReconcileJob.class);

    /** Bounds one run so a large first crawl cannot monopolise the scheduler. */
    static final int MAX_BATCHES_PER_RUN = 5;

    private final SearchProperties properties;
    private final DocumentSearchRepository repository;
    private final YhubClient yhubClient;

    @Scheduled(
            fixedDelayString = "${app.search.reconcile-interval-ms:600000}",
            initialDelayString = "${app.search.reconcile-initial-delay-ms:30000}")
    public void reconcile() {
        if (!properties.isEnabled()) {
            return;
        }
        try {
            runOnce();
        } catch (RuntimeException e) {
            log.warn("Search reconcile pass failed: {}", e.getClass().getSimpleName());
        }
    }

    void runOnce() {
        UUID cursor = repository.readCursor();
        // One cutoff for the whole run, so a slow pass cannot move the goalposts mid-crawl.
        OffsetDateTime verifiedBefore = OffsetDateTime.now(ZoneOffset.UTC).minus(properties.getMaxVerificationAge());
        // The realtime service caps a reindex request at the same value, so one batch is
        // always one request.
        int batchSize = Math.max(1, properties.getMaxReindexDocs());
        int requested = 0;
        for (int batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
            List<UUID> stale = repository.selectStaleAfter(cursor, verifiedBefore, batchSize);
            if (stale.isEmpty()) {
                // Start the next pass from the beginning: a document that failed on this
                // pass gets another attempt instead of waiting for a full wrap.
                cursor = null;
                repository.writeCursor(null);
                break;
            }
            yhubClient.reindexContent(stale, batchSize);
            cursor = stale.get(stale.size() - 1);
            // Advance even if the request fails in the background. The row stays stale,
            // so the next pass retries it; holding the cursor would block every id after
            // a permanently broken document.
            repository.writeCursor(cursor);
            requested += stale.size();
        }
        if (requested > 0) {
            log.info("Requested search reindex for {} document(s)", requested);
        }
    }
}
