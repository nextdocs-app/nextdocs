package com.nextdocs.api.realtime.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.nextdocs.api.realtime.client.YhubClient;
import com.nextdocs.api.realtime.entity.YhubPurgeOutbox;
import com.nextdocs.api.realtime.schedule.YhubPurgeJob;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Two replicas drain the same outbox. The query must hand each pending row to one drainer
 * only: a duplicate hard delete is wasteful and spends the retry budget twice.
 */
@SpringBootTest(properties = "app.yhub.purge-interval-ms=3600000")
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class YhubPurgeOutboxLockTest {

    @Autowired
    private YhubPurgeOutboxRepository outboxRepository;

    @Autowired
    private YhubPurgeJob purgeJob;

    @MockitoBean
    private YhubClient yhubClient;

    @Test
    void twoDrainersCannotSelectTheSamePendingRow() throws Exception {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        UUID documentId = UUID.randomUUID();
        outboxRepository.saveAndFlush(YhubPurgeOutbox.builder()
                .id(UUID.randomUUID())
                .documentId(documentId)
                .attempts(0)
                .nextAttemptAt(now.minusMinutes(1))
                .createdAt(now)
                .build());

        CountDownLatch firstDeleting = new CountDownLatch(1);
        CountDownLatch releaseFirst = new CountDownLatch(1);
        when(yhubClient.hardDelete(documentId)).thenAnswer(invocation -> {
            firstDeleting.countDown();
            await(releaseFirst);
            return true;
        });

        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> first = pool.submit(() -> purgeJob.drain());
            assertThat(firstDeleting.await(5, TimeUnit.SECONDS)).isTrue();

            // The second drainer starts while the first holds the row and its transaction.
            Future<?> second = pool.submit(() -> purgeJob.drain());
            releaseFirst.countDown();

            first.get(10, TimeUnit.SECONDS);
            second.get(10, TimeUnit.SECONDS);

            // One hard delete for one pending row: the second drainer either skipped the
            // locked row or saw it completed after the first committed.
            verify(yhubClient, timeout(2000).times(1)).hardDelete(documentId);
        } finally {
            pool.shutdownNow();
        }
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("timed out waiting for the first drainer");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }
}
