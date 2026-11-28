package com.nextdocs.api.realtime.service;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Service;

/**
 * Chooses the instant that orders one content-updated read, for both projections it
 * carries.
 *
 * <p>A sender whose clock runs ahead of ours cannot order its own reads: the instant it
 * names would outrank every read that lands before its clock catches up, so the value is
 * capped at arrival time.
 *
 * <p>Capping alone is not enough. Realtime retries the same body after a failed call, and a
 * second cap would hand that retry a later instant than the read it duplicates — later
 * enough to overwrite a newer body that landed in between and restore a mention that body
 * removed. The cap is therefore remembered for a short window, keyed by the read it belongs
 * to (the document plus the instant the sender named), so every attempt of one body orders
 * by the same value while a genuinely newer read still gets a newer one.
 *
 * <p>A body that names no {@code producedAt} is not remembered: the key would be the
 * document alone, so a second, different read inside the window would be ordered behind the
 * first one. Those bodies keep falling back to arrival time, and so does the older realtime
 * build that sends no instant at all — that build sends no mention set either, so there is
 * no mention order for it to disturb.
 */
@Service
public class ProducedAtVersions {

    /** Comfortably longer than realtime's retry budget (three attempts, ~1 s apart). */
    static final long DEFAULT_RETENTION_NANOS = Duration.ofSeconds(30).toNanos();

    /** A public-facing instance must not grow per-read state without a bound. */
    static final int DEFAULT_MAX_ENTRIES = 10_000;

    private final int maxEntries;
    private final long retentionNanos;

    /** The cap this read was first given, so a retry of it orders by the same instant. */
    private final Map<Read, Capped> capped = new ConcurrentHashMap<>();

    private record Read(UUID documentId, Instant producedAt) {}

    private record Capped(Instant version, long assignedAtNanos) {}

    public ProducedAtVersions() {
        this(DEFAULT_MAX_ENTRIES, DEFAULT_RETENTION_NANOS);
    }

    /** Test seam: the bound and the window are constructor inputs so both are testable. */
    ProducedAtVersions(int maxEntries, long retentionNanos) {
        this.maxEntries = maxEntries;
        this.retentionNanos = retentionNanos;
    }

    /**
     * @param producedAt the instant the sender says it read the document, or null when the
     *     body carries none
     * @param arrivedAt the instant the request reached us; the cap for an untrustworthy
     *     {@code producedAt}, and the fallback for a missing one
     */
    public Instant assign(UUID documentId, Instant producedAt, Instant arrivedAt) {
        if (producedAt == null || !producedAt.isAfter(arrivedAt)) {
            // A value from the past orders itself; a body without one has nothing better
            // than arrival time to order by.
            return producedAt == null ? arrivedAt : producedAt;
        }

        Read read = new Read(documentId, producedAt);
        long now = System.nanoTime();
        Capped previous = capped.get(read);
        if (previous != null && now - previous.assignedAtNanos() < retentionNanos) {
            return previous.version();
        }

        remember(read, new Capped(arrivedAt, now), now);
        return arrivedAt;
    }

    private void remember(Read read, Capped cap, long now) {
        if (capped.size() >= maxEntries) {
            // The bound is memory, not correctness: an entry dropped here only means a
            // retry that arrives after the window would be capped a second time.
            capped.entrySet().removeIf(entry -> now - entry.getValue().assignedAtNanos() >= retentionNanos);
            if (capped.size() >= maxEntries) {
                return;
            }
        }
        capped.put(read, cap);
    }
}
