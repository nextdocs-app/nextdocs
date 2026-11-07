package com.nextdocs.api.realtime.schedule;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.realtime.client.YhubClient;
import com.nextdocs.api.realtime.service.YhubProjectionStateStore;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class YhubProjectionJobTest {

    @Mock
    private DocumentRepository documentRepository;

    @Mock
    private YhubClient yhubClient;

    @Mock
    private YhubProjectionStateStore stateStore;

    private YhubProjectionJob job;
    private final UUID documentId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        job = new YhubProjectionJob(documentRepository, yhubClient, stateStore);
    }

    private void page(long cursor, long next, long clock) {
        when(stateStore.tryAcquire(any(), any())).thenReturn(true);
        when(stateStore.cursor()).thenReturn(cursor);
        when(yhubClient.updatedSince(cursor, 100))
                .thenReturn(Optional.of(new YhubClient.UpdatedResponse(
                        List.of(new YhubClient.UpdatedDocument(documentId.toString(), clock)), next)));
    }

    @Test
    void doesNothingWhenAnotherInstanceHoldsTheLease() {
        when(stateStore.tryAcquire(any(), any())).thenReturn(false);

        job.syncProjection();

        verifyNoInteractions(yhubClient);
        verify(stateStore, never()).release(any());
    }

    @Test
    void appliesTheSnapshotAndAdvancesOnlyAfterThePageIsDone() {
        page(5L, 9L, 20L);
        when(documentRepository.findYhubClockById(documentId)).thenReturn(Optional.of(10L));
        when(yhubClient.fetchUpdate(documentId)).thenReturn(YhubClient.UpdateFetch.ok(new byte[] {1, 2, 3}));
        when(stateStore.advance(any(), eq(9L))).thenReturn(true);

        job.syncProjection();

        verify(documentRepository).applyYhubProjection(documentId, new byte[] {1, 2, 3}, 20L);
        verify(stateStore).advance(any(), eq(9L));
        verify(stateStore).release(any());
    }

    @Test
    void aTransientReadFailureDoesNotAdvancePastTheDocument() {
        page(5L, 9L, 20L);
        when(documentRepository.findYhubClockById(documentId)).thenReturn(Optional.of(10L));
        when(yhubClient.fetchUpdate(documentId)).thenReturn(YhubClient.UpdateFetch.transientFailure());

        job.syncProjection();

        verify(stateStore, never()).advance(any(), anyLong());
        verify(stateStore).release(any());
    }

    @Test
    void aMissingYhubDocumentMarksTheRowDeleted() {
        page(5L, 9L, 20L);
        when(documentRepository.findYhubClockById(documentId)).thenReturn(Optional.of(10L));
        when(yhubClient.fetchUpdate(documentId)).thenReturn(YhubClient.UpdateFetch.notFound());
        when(stateStore.advance(any(), eq(9L))).thenReturn(true);

        job.syncProjection();

        verify(documentRepository).markYhubDeleted(eq(documentId), eq(20L), any());
        verify(documentRepository, never()).applyYhubProjection(any(), any(), anyLong());
        verify(stateStore).advance(any(), eq(9L));
    }

    @Test
    void skipsDocumentsThatAreAlreadyAtTheClock() {
        page(5L, 9L, 20L);
        when(documentRepository.findYhubClockById(documentId)).thenReturn(Optional.of(20L));
        when(stateStore.advance(any(), eq(9L))).thenReturn(true);

        job.syncProjection();

        verify(yhubClient, never()).fetchUpdate(documentId);
        verify(stateStore).advance(any(), eq(9L));
    }

    @Test
    void leavesTheCursorAloneWhenTheCursorQueryFails() {
        when(stateStore.tryAcquire(any(), any())).thenReturn(true);
        when(stateStore.cursor()).thenReturn(5L);
        when(yhubClient.updatedSince(5L, 100)).thenReturn(Optional.empty());

        job.syncProjection();

        verify(stateStore, never()).advance(any(), anyLong());
        verify(stateStore).release(any());
    }

    @Test
    void ignoresNonUuidDocumentsAndDocumentsMissingFromPostgres() {
        when(stateStore.tryAcquire(any(), any())).thenReturn(true);
        when(stateStore.cursor()).thenReturn(5L);
        when(yhubClient.updatedSince(5L, 100))
                .thenReturn(Optional.of(new YhubClient.UpdatedResponse(
                        List.of(
                                new YhubClient.UpdatedDocument("not-a-uuid", 20L),
                                new YhubClient.UpdatedDocument(documentId.toString(), 20L)),
                        9L)));
        when(documentRepository.findYhubClockById(documentId)).thenReturn(Optional.empty());
        when(stateStore.advance(any(), eq(9L))).thenReturn(true);

        job.syncProjection();

        verify(yhubClient, never()).fetchUpdate(documentId);
        verify(stateStore).advance(any(), eq(9L));
    }

    @Test
    void stopsAtThePageBudgetWithoutAdvancingTheCursor() {
        job = new YhubProjectionJob(documentRepository, yhubClient, stateStore, Duration.ZERO);
        page(5L, 9L, 20L);

        job.syncProjection();

        // The budget is checked before each document, so a page that cannot finish inside
        // the lease never starts work whose result would have to be replayed.
        verify(yhubClient, never()).fetchUpdate(documentId);
        verify(documentRepository, never()).applyYhubProjection(any(), any(), anyLong());
        verify(stateStore, never()).advance(any(), anyLong());
        verify(stateStore).release(any());
    }

    @Test
    void releasesTheLeaseEvenWhenThePageThrows() {
        when(stateStore.tryAcquire(any(), any())).thenReturn(true);
        when(stateStore.cursor()).thenThrow(new IllegalStateException("db down"));

        job.syncProjection();

        verify(stateStore).release(any());
    }
}
