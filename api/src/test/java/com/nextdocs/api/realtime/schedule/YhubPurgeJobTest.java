package com.nextdocs.api.realtime.schedule;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.nextdocs.api.realtime.client.YhubClient;
import com.nextdocs.api.realtime.entity.YhubPurgeOutbox;
import com.nextdocs.api.realtime.repository.YhubPurgeOutboxRepository;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class YhubPurgeJobTest {

    @Mock
    private YhubPurgeOutboxRepository outboxRepository;

    @Mock
    private YhubClient yhubClient;

    private YhubPurgeJob job;
    private YhubPurgeOutbox entry;
    private final UUID documentId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        job = new YhubPurgeJob(outboxRepository, yhubClient);
        entry = YhubPurgeOutbox.builder()
                .id(UUID.randomUUID())
                .documentId(documentId)
                .attempts(0)
                .nextAttemptAt(OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(1))
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();
        when(outboxRepository.findTop50ByCompletedAtIsNullAndNextAttemptAtLessThanEqualOrderByNextAttemptAtAsc(any()))
                .thenReturn(List.of(entry));
    }

    @Test
    void marksASuccessfulDeleteCompleted() {
        when(yhubClient.hardDelete(documentId)).thenReturn(true);

        job.drain();

        assertNotNull(entry.getCompletedAt());
        assertNull(entry.getLastError());
        verify(outboxRepository).save(entry);
    }

    @Test
    void aRejectedDeleteIsRetriedWithBackoff() {
        when(yhubClient.hardDelete(documentId)).thenReturn(false);
        OffsetDateTime before = OffsetDateTime.now(ZoneOffset.UTC);

        job.drain();

        assertNull(entry.getCompletedAt());
        assertTrue(entry.getAttempts() >= 1);
        assertNotNull(entry.getLastError());
        assertTrue(entry.getNextAttemptAt().isAfter(before));
    }

    @Test
    void anExceptionIsTreatedAsARetryAndDoesNotAbortTheDrain() {
        when(yhubClient.hardDelete(documentId)).thenThrow(new RuntimeException("connection reset"));

        job.drain();

        assertNull(entry.getCompletedAt());
        assertTrue(entry.getAttempts() >= 1);
        assertTrue(entry.getLastError().contains("connection reset"));
        verify(outboxRepository).save(entry);
    }

    @Test
    void prunesOldCompletedRows() {
        job.drain();

        verify(outboxRepository).deleteCompletedBefore(any());
    }
}
