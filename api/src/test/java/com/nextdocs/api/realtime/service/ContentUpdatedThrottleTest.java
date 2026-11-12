package com.nextdocs.api.realtime.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.nextdocs.api.document.repository.DocumentRepository;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.slf4j.LoggerFactory;

@ExtendWith(MockitoExtension.class)
class ContentUpdatedThrottleTest {

    private static final long WINDOW_NANOS = 5_000_000_000L;

    @Mock
    private DocumentRepository documentRepository;

    private final ListAppender<ILoggingEvent> appender = new ListAppender<>();
    private final Logger logger = (Logger) LoggerFactory.getLogger(ContentUpdatedThrottle.class);

    @BeforeEach
    void attachLogCapture() {
        appender.start();
        logger.addAppender(appender);
    }

    @AfterEach
    void detachLogCapture() {
        logger.detachAppender(appender);
        appender.stop();
    }

    @Test
    void writesTheFirstNotification() {
        ContentUpdatedThrottle throttle = new ContentUpdatedThrottle(documentRepository);
        UUID documentId = UUID.randomUUID();

        throttle.record(documentId, Instant.now());

        verify(documentRepository).markContentUpdated(eq(documentId), any());
    }

    @Test
    void defersTheLastNotificationAndWritesItWhenTheWindowCloses() {
        ContentUpdatedThrottle throttle = new ContentUpdatedThrottle(documentRepository);
        UUID documentId = UUID.randomUUID();

        throttle.record(documentId, Instant.now());
        throttle.record(documentId, Instant.now());

        // The second notification is inside the window: one write so far.
        verify(documentRepository, times(1)).markContentUpdated(eq(documentId), any());

        // Dropping it instead would leave the sidebar sort key stale until the next edit.
        throttle.flush(System.nanoTime() + WINDOW_NANOS * 2);

        verify(documentRepository, times(2)).markContentUpdated(eq(documentId), any());
    }

    @Test
    void keepsTheDeferredEntryWhenAWriteFails() {
        ContentUpdatedThrottle throttle = new ContentUpdatedThrottle(documentRepository);
        UUID documentId = UUID.randomUUID();
        when(documentRepository.markContentUpdated(eq(documentId), any()))
                .thenReturn(1)
                .thenThrow(new IllegalStateException("database unavailable"))
                .thenReturn(1);

        throttle.record(documentId, Instant.now());
        throttle.record(documentId, Instant.now());

        // The first flush fails; the deferred entry must survive so the next tick retries it
        // instead of leaving the sort key stale until the document is edited again.
        throttle.flush(System.nanoTime() + WINDOW_NANOS * 2);
        assertThat(appender.list)
                .filteredOn(event -> event.getLevel() == Level.WARN)
                .hasSize(1);

        throttle.flush(System.nanoTime() + WINDOW_NANOS * 2);

        verify(documentRepository, times(3)).markContentUpdated(eq(documentId), any());
    }

    @Test
    void warnsOnceWhenTheDeferredCapIsReached() {
        // Two entries make the cap reachable without 10k notifications.
        ContentUpdatedThrottle throttle = new ContentUpdatedThrottle(documentRepository, 2, WINDOW_NANOS);
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        UUID overflow = UUID.randomUUID();

        for (UUID documentId : new UUID[] {first, second}) {
            throttle.record(documentId, Instant.now());
            throttle.record(documentId, Instant.now());
        }

        // Each extra notification past the cap is dropped; the cap is a memory bound,
        // and Yhub sends another one on the next compaction.
        throttle.record(overflow, Instant.now());
        throttle.record(overflow, Instant.now());
        throttle.record(overflow, Instant.now());

        assertThat(appender.list)
                .filteredOn(event -> event.getLevel() == Level.WARN)
                .hasSize(1);
        assertThat(appender.list.getFirst().getFormattedMessage()).contains("queue is full");
    }

    @Test
    void aDeferredWriteKeepsTheNotificationInstant() {
        ContentUpdatedThrottle throttle = new ContentUpdatedThrottle(documentRepository, 10, WINDOW_NANOS);
        UUID documentId = UUID.randomUUID();
        Instant first = Instant.parse("2026-01-01T00:00:00Z");
        Instant second = first.plusSeconds(1);

        throttle.record(documentId, first);
        // Inside the window, so the write is deferred. Stamping the flush time instead
        // would place updated_at after the projection indexed for `second`, and the
        // reconcile crawl would re-extract a document that was just indexed.
        throttle.record(documentId, second);
        throttle.flush(System.nanoTime() + WINDOW_NANOS * 2);

        ArgumentCaptor<OffsetDateTime> written = ArgumentCaptor.forClass(OffsetDateTime.class);
        verify(documentRepository, times(2)).markContentUpdated(eq(documentId), written.capture());
        assertThat(written.getAllValues().get(1).toInstant()).isEqualTo(second);
    }

    @Test
    void aFailedWriteDoesNotStartTheThrottleWindow() {
        ContentUpdatedThrottle throttle = new ContentUpdatedThrottle(documentRepository);
        UUID documentId = UUID.randomUUID();
        when(documentRepository.markContentUpdated(eq(documentId), any()))
                .thenThrow(new IllegalStateException("database unavailable"))
                .thenReturn(1);

        assertThrows(IllegalStateException.class, () -> throttle.record(documentId, Instant.now()));
        throttle.record(documentId, Instant.now());

        // A failure must not suppress the next notification for the whole window.
        verify(documentRepository, times(2)).markContentUpdated(eq(documentId), any());
    }
}
