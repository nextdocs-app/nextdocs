package com.nextdocs.api.realtime.schedule;

import com.nextdocs.api.realtime.client.YhubClient;
import com.nextdocs.api.realtime.entity.YhubPurgeOutbox;
import com.nextdocs.api.realtime.repository.YhubPurgeOutboxRepository;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Drains the purge outbox.
 *
 * <p>The outbox row is written in the same transaction as the document delete, so an
 * orphaned Yhub document is a retryable state rather than a lost one. Backoff is capped so
 * a Yhub outage delays deletion but never drops it.
 *
 * <p>Deliberately not tied to {@code app.yhub.projection-enabled}: turning the projection off
 * (for example to run it in another process) must not strand the content of deleted
 * documents, which is what this job is the only way to remove.
 */
@Component
@ConditionalOnProperty(name = "app.yhub.purge-enabled", havingValue = "true", matchIfMissing = true)
public class YhubPurgeJob {

    private static final Logger log = LoggerFactory.getLogger(YhubPurgeJob.class);

    private static final Duration BASE_DELAY = Duration.ofSeconds(30);

    private static final Duration MAX_DELAY = Duration.ofHours(1);

    private static final Duration COMPLETED_RETENTION = Duration.ofDays(7);

    private final YhubPurgeOutboxRepository outboxRepository;
    private final YhubClient yhubClient;

    public YhubPurgeJob(YhubPurgeOutboxRepository outboxRepository, YhubClient yhubClient) {
        this.outboxRepository = outboxRepository;
        this.yhubClient = yhubClient;
    }

    @Scheduled(fixedDelayString = "${app.yhub.purge-interval-ms:30000}")
    public void drain() {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        List<YhubPurgeOutbox> pending =
                outboxRepository.findTop50ByCompletedAtIsNullAndNextAttemptAtLessThanEqualOrderByNextAttemptAtAsc(now);

        for (YhubPurgeOutbox entry : pending) {
            try {
                if (yhubClient.hardDelete(entry.getDocumentId())) {
                    entry.setCompletedAt(now);
                    entry.setLastError(null);
                } else {
                    fail(entry, now, "hard delete was rejected");
                }
            } catch (RuntimeException e) {
                fail(entry, now, e.getMessage());
            }
            outboxRepository.save(entry);
        }

        try {
            outboxRepository.deleteCompletedBefore(now.minus(COMPLETED_RETENTION));
        } catch (RuntimeException e) {
            log.debug("Could not prune completed purge outbox rows: {}", e.getMessage());
        }
    }

    private void fail(YhubPurgeOutbox entry, OffsetDateTime now, String error) {
        int attempts = entry.getAttempts() + 1;
        entry.setAttempts(attempts);
        entry.setLastError(error == null ? null : truncate(error));
        long seconds = Math.min(MAX_DELAY.getSeconds(), BASE_DELAY.getSeconds() * (1L << Math.min(attempts, 10)));
        entry.setNextAttemptAt(now.plusSeconds(seconds));
        log.warn(
                "Yhub purge retry {} for document {} in {}s: {}",
                attempts,
                entry.getDocumentId(),
                seconds,
                entry.getLastError());
    }

    private String truncate(String value) {
        return value.length() <= 500 ? value : value.substring(0, 500);
    }
}
