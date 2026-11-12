package com.nextdocs.api.search.schedule;

import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.nextdocs.api.realtime.client.YhubClient;
import com.nextdocs.api.search.config.SearchProperties;
import com.nextdocs.api.search.repository.DocumentSearchRepository;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class DocumentSearchReconcileJobTest {

    @Mock
    private SearchProperties properties;

    @Mock
    private DocumentSearchRepository repository;

    @Mock
    private YhubClient yhubClient;

    private DocumentSearchReconcileJob job;

    @BeforeEach
    void setUp() {
        job = new DocumentSearchReconcileJob(properties, repository, yhubClient);
    }

    @Test
    void walksBatchesAndResetsTheCursorWhenTheStaleSetIsEmpty() {
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        when(properties.getMaxReindexDocs()).thenReturn(2);
        when(repository.readCursor()).thenReturn(null);
        when(repository.selectStaleAfter(null, 2)).thenReturn(List.of(first, second));
        when(repository.selectStaleAfter(second, 2)).thenReturn(List.of());

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
        when(properties.getMaxReindexDocs()).thenReturn(1);
        when(repository.readCursor()).thenReturn(null);
        when(repository.selectStaleAfter(null, 1)).thenReturn(List.of(id));
        when(repository.selectStaleAfter(id, 1)).thenReturn(List.of(id));

        job.runOnce();

        // A large first crawl must not monopolise the shared scheduler thread.
        verify(yhubClient, times(DocumentSearchReconcileJob.MAX_BATCHES_PER_RUN))
                .reindexContent(List.of(id), 1);
        verify(repository, times(DocumentSearchReconcileJob.MAX_BATCHES_PER_RUN))
                .writeCursor(id);
    }

    @Test
    void doesNothingWhenSearchIsDisabled() {
        when(properties.isEnabled()).thenReturn(false);

        job.reconcile();

        verifyNoInteractions(repository, yhubClient);
    }
}
