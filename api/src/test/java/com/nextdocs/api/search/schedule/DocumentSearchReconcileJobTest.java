package com.nextdocs.api.search.schedule;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.nextdocs.api.realtime.client.YhubClient;
import com.nextdocs.api.search.config.SearchProperties;
import com.nextdocs.api.search.repository.DocumentSearchRepository;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class DocumentSearchReconcileJobTest {

    @Mock
    private DocumentSearchRepository repository;

    @Mock
    private YhubClient yhubClient;

    private SearchProperties properties;

    private DocumentSearchReconcileJob job;

    @BeforeEach
    void setUp() {
        properties = new SearchProperties();
        job = new DocumentSearchReconcileJob(properties, repository, yhubClient);
    }

    @Test
    void walksBatchesAndResetsTheCursorWhenTheStaleSetIsEmpty() {
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        properties.setMaxReindexDocs(2);
        when(repository.selectStaleAfter(isNull(), any(OffsetDateTime.class), eq(2)))
                .thenReturn(List.of(first, second));
        when(repository.selectStaleAfter(eq(second), any(OffsetDateTime.class), eq(2)))
                .thenReturn(List.of());

        job.runOnce();

        verify(yhubClient).reindexContent(List.of(first, second), 2);
        verify(repository).writeCursor(second);
        // A wrap starts the next pass at the beginning, so a document that failed gets
        // another attempt without waiting for the cursor to travel all the way around.
        verify(repository).writeCursor(null);
    }

    @Test
    void stopsAfterThePerRunBatchCap() {
        UUID id = UUID.randomUUID();
        properties.setMaxReindexDocs(1);
        when(repository.selectStaleAfter(isNull(), any(OffsetDateTime.class), eq(1)))
                .thenReturn(List.of(id));
        when(repository.selectStaleAfter(eq(id), any(OffsetDateTime.class), eq(1)))
                .thenReturn(List.of(id));

        job.runOnce();

        // A large first crawl must not monopolise the shared scheduler thread.
        verify(yhubClient, times(DocumentSearchReconcileJob.MAX_BATCHES_PER_RUN))
                .reindexContent(List.of(id), 1);
        verify(repository, times(DocumentSearchReconcileJob.MAX_BATCHES_PER_RUN))
                .writeCursor(id);
    }

    @Test
    void doesNothingWhenSearchIsDisabled() {
        properties.setEnabled(false);

        job.reconcile();

        verifyNoInteractions(repository, yhubClient);
    }

    @Test
    void passesTheConfiguredVerificationAgeAsTheCutoff() {
        properties.setMaxVerificationAge(Duration.ofHours(2));
        when(repository.selectStaleAfter(isNull(), any(OffsetDateTime.class), eq(50)))
                .thenReturn(List.of());

        job.runOnce();

        ArgumentCaptor<OffsetDateTime> cutoff = ArgumentCaptor.forClass(OffsetDateTime.class);
        verify(repository).selectStaleAfter(isNull(), cutoff.capture(), eq(50));
        OffsetDateTime expected = OffsetDateTime.now(ZoneOffset.UTC).minusHours(2);
        // One cutoff for the whole run; a few milliseconds of execution time is fine.
        assertThat(cutoff.getValue()).isBetween(expected.minusMinutes(1), expected.plusMinutes(1));
    }
}
