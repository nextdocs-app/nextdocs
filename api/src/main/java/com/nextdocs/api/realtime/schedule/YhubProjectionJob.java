package com.nextdocs.api.realtime.schedule;

import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.realtime.client.YhubClient;
import com.nextdocs.api.realtime.service.YhubProjectionStateStore;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Copies Yhub's authoritative document state into Postgres.
 *
 * <p>Each run takes a lease on the singleton cursor, reads one page and advances the
 * cursor only after every document in the page was applied. A transient read failure stops
 * the page without advancing, so the next run retries the same cursor instead of silently
 * skipping content. A 404 marks the row deleted; an empty snapshot is real content and
 * must never be treated as absence.
 *
 * <p>A page also has a wall-clock budget. Every document costs up to the fetch timeout, so
 * a page of slow reads can outlive the lease; a second replica would then take the lease
 * and replay the page while the first is still writing it, and the first run's advance
 * would be rejected. Stopping at the budget keeps the lease comfortably longer than the
 * work, and replay is cheap because the clock check skips what was already applied.
 */
@Component
@ConditionalOnProperty(name = "app.yhub.projection-enabled", havingValue = "true", matchIfMissing = true)
public class YhubProjectionJob {

    private static final Logger log = LoggerFactory.getLogger(YhubProjectionJob.class);

    private static final int PAGE_SIZE = 100;

    /** Comfortably longer than the page budget: the lease must outlive the work. */
    private static final Duration LEASE = Duration.ofMinutes(5);

    /** Leaves the run time to release the lease before another replica may take it. */
    private static final Duration PAGE_BUDGET = Duration.ofSeconds(90);

    private final DocumentRepository documentRepository;
    private final YhubClient yhubClient;
    private final YhubProjectionStateStore stateStore;
    private final Duration pageBudget;
    private final UUID instanceId = UUID.randomUUID();

    @Autowired
    public YhubProjectionJob(
            DocumentRepository documentRepository, YhubClient yhubClient, YhubProjectionStateStore stateStore) {
        this(documentRepository, yhubClient, stateStore, PAGE_BUDGET);
    }

    /** Test seam: a caller-chosen budget without a Spring context. */
    YhubProjectionJob(
            DocumentRepository documentRepository,
            YhubClient yhubClient,
            YhubProjectionStateStore stateStore,
            Duration pageBudget) {
        this.documentRepository = documentRepository;
        this.yhubClient = yhubClient;
        this.stateStore = stateStore;
        this.pageBudget = pageBudget;
    }

    @Scheduled(fixedDelayString = "${app.yhub.projection-interval-ms:10000}")
    public void syncProjection() {
        if (!stateStore.tryAcquire(instanceId, LEASE)) {
            return;
        }
        try {
            syncPage();
        } catch (RuntimeException e) {
            log.warn("Yhub projection sync encountered an error: {}", e.getMessage());
        } finally {
            stateStore.release(instanceId);
        }
    }

    private void syncPage() {
        long cursor = stateStore.cursor();
        Optional<YhubClient.UpdatedResponse> responseOpt = yhubClient.updatedSince(cursor, PAGE_SIZE);
        if (responseOpt.isEmpty()) {
            // Transient backend failure: leave the cursor untouched so this page is retried.
            return;
        }

        YhubClient.UpdatedResponse response = responseOpt.get();
        long startedAt = System.nanoTime();
        long deadline = startedAt + pageBudget.toNanos();
        int applied = 0;
        int skipped = 0;
        boolean stoppedEarly = false;

        if (response.docs() != null) {
            for (YhubClient.UpdatedDocument updated : response.docs()) {
                if (System.nanoTime() - deadline >= 0) {
                    stoppedEarly = true;
                    break;
                }

                UUID docId;
                try {
                    docId = UUID.fromString(updated.docid());
                } catch (IllegalArgumentException e) {
                    continue;
                }

                Optional<Long> currentClock = documentRepository.findYhubClockById(docId);
                if (currentClock.isEmpty() || currentClock.get() >= updated.t()) {
                    // Deleted from Postgres after it changed in Yhub (the purge outbox owns
                    // removing Yhub content), or already applied by an earlier run.
                    skipped++;
                    continue;
                }

                YhubClient.UpdateFetch fetch = yhubClient.fetchUpdate(docId);
                if (fetch.status() == YhubClient.FetchStatus.TRANSIENT) {
                    // Do not advance past a document we could not read: doing so would
                    // lose this revision permanently.
                    return;
                }

                if (fetch.status() == YhubClient.FetchStatus.NOT_FOUND) {
                    documentRepository.markYhubDeleted(docId, updated.t(), OffsetDateTime.now(ZoneOffset.UTC));
                } else {
                    documentRepository.applyYhubProjection(docId, fetch.update(), updated.t());
                }
                applied++;
            }
        }

        if (stoppedEarly) {
            // No advance: the next run replays this position, and the clock check makes
            // the replayed documents nearly free.
            log.info(
                    "Yhub projection stopped at its {} page budget after {} ms: {} applied, {} skipped; retrying from cursor {}",
                    pageBudget,
                    (System.nanoTime() - startedAt) / 1_000_000,
                    applied,
                    skipped,
                    cursor);
            return;
        }

        if (!stateStore.advance(instanceId, response.next())) {
            log.warn("Yhub projection lease was lost before advancing cursor to {}", response.next());
        } else if (applied > 0) {
            log.debug(
                    "Yhub projection applied {} document(s) in {} ms and advanced cursor to {}",
                    applied,
                    (System.nanoTime() - startedAt) / 1_000_000,
                    response.next());
        }
    }
}
