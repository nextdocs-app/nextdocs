package com.nextdocs.api.realtime.service;

import com.nextdocs.api.document.repository.DocumentRepository;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * Coalesces Yhub's content-updated notifications into one {@code updated_at} write per
 * document per window.
 *
 * <p>Yhub compacts on a timer and fires one notification per document that changed. A bulk
 * import compacts many documents back to back, and a row write per document per tick would be
 * pure amplification — nothing reads {@code updated_at} more precisely than a few seconds. The
 * last notification of a burst is deferred and written when the window closes, so the sidebar
 * sort key cannot stay stale until the next edit.
 *
 * <p>The schedule lives here rather than on the controller: a {@code @Scheduled} method on a
 * request handler mixed two lifetimes in one bean, and the throttle state has nothing to do
 * with HTTP.
 */
@Service
public class ContentUpdatedThrottle {

    private static final Logger log = LoggerFactory.getLogger(ContentUpdatedThrottle.class);

    static final long DEFAULT_THROTTLE_NANOS = Duration.ofSeconds(5).toNanos();

    /** A public-facing instance must not grow per-document state without a bound. */
    static final int DEFAULT_MAX_ENTRIES = 10_000;

    private final DocumentRepository documentRepository;
    private final int maxEntries;
    private final long throttleNanos;

    /** When this document's last write landed, in {@link System#nanoTime()} units. */
    private final ConcurrentHashMap<UUID, Long> lastWrittenAt = new ConcurrentHashMap<>();

    /** Documents whose notification landed inside the window, awaiting the flush. */
    private final Set<UUID> deferred = ConcurrentHashMap.newKeySet();

    /** One warning per full-cap episode, not one per dropped notification. */
    private final AtomicBoolean capWarned = new AtomicBoolean(false);

    @Autowired
    public ContentUpdatedThrottle(DocumentRepository documentRepository) {
        this(documentRepository, DEFAULT_MAX_ENTRIES, DEFAULT_THROTTLE_NANOS);
    }

    /** Test seam: the bound and window are constructor inputs so the cap is testable. */
    ContentUpdatedThrottle(DocumentRepository documentRepository, int maxEntries, long throttleNanos) {
        this.documentRepository = documentRepository;
        this.maxEntries = maxEntries;
        this.throttleNanos = throttleNanos;
    }

    /**
     * Records a content-updated notification. Returns immediately; the write is either
     * done now or deferred to {@link #flush()}.
     */
    public void record(UUID documentId) {
        long now = System.nanoTime();
        Long previous = lastWrittenAt.get(documentId);
        if (previous != null && now - previous < throttleNanos) {
            // Trailing edge: the last compaction of a burst must not be dropped, or the
            // sort key stays stale until the document is edited again.
            if (deferred.size() < maxEntries) {
                deferred.add(documentId);
            } else if (capWarned.compareAndSet(false, true)) {
                // The cap is a memory bound, not a correctness one: Yhub fires again on the
                // next compaction, so a dropped entry only delays the sort key. Say so once
                // per episode instead of silently returning 200 for every notification.
                log.warn(
                        "Deferred content-updated queue is full ({} entries); dropping further notifications until it drains.",
                        maxEntries);
            }
            return;
        }
        write(documentId, now);
    }

    /** Flushes notifications whose window has closed. */
    @Scheduled(fixedDelayString = "${app.yhub.content-updated-flush-interval-ms:1000}")
    public void flush() {
        flush(System.nanoTime());
    }

    void flush(long nowNanos) {
        for (UUID documentId : deferred) {
            Long previous = lastWrittenAt.get(documentId);
            if (previous != null && nowNanos - previous < throttleNanos) {
                continue;
            }
            try {
                write(documentId, nowNanos);
                deferred.remove(documentId);
            } catch (RuntimeException e) {
                // Stay deferred: the next tick retries rather than leaving the sort key
                // behind for good. Only the exception type is logged.
                log.warn(
                        "Deferred content-updated write failed for {}: {}",
                        documentId,
                        e.getClass().getSimpleName());
            }
        }
        if (deferred.size() < maxEntries) {
            capWarned.set(false);
        }
    }

    private void write(UUID documentId, long nowNanos) {
        if (lastWrittenAt.size() >= maxEntries) {
            // Bounded reset rather than an LRU: the map only suppresses redundant writes,
            // so losing it costs one extra UPDATE per document at worst.
            lastWrittenAt.clear();
        }
        documentRepository.markContentUpdated(documentId, OffsetDateTime.now(ZoneOffset.UTC));
        lastWrittenAt.put(documentId, nowNanos);
    }
}
