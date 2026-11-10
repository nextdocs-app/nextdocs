package com.nextdocs.api.realtime.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.nextdocs.api.document.repository.DocumentRepository;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class RealtimeAccessScopeResolverTest {

    @Mock
    private DocumentRepository documentRepository;

    @InjectMocks
    private RealtimeAccessScopeResolver resolver;

    @Test
    void expandsOneDocumentOneLevelPastTheDepthCap() {
        UUID documentId = UUID.randomUUID();
        when(documentRepository.findSubtreeIdsIncludingTrashed(documentId, 101)).thenReturn(List.of(documentId));

        assertThat(resolver.forDocument(documentId)).containsExactly(documentId);
        // The access chain admits 100 edges from the root, so the subtree walk has to
        // admit 101 nodes or the deepest page never gets its revocation recheck.
        verify(documentRepository).findSubtreeIdsIncludingTrashed(documentId, 101);
    }

    @Test
    void expandsEverySpaceRootInOneWalk() {
        UUID spaceId = UUID.randomUUID();
        UUID firstRoot = UUID.randomUUID();
        UUID secondRoot = UUID.randomUUID();
        List<UUID> roots = List.of(firstRoot, secondRoot);
        List<UUID> subtree = List.of(firstRoot, secondRoot, UUID.randomUUID());

        when(documentRepository.findIdsBySpace_Id(spaceId)).thenReturn(roots);
        when(documentRepository.findSubtreesIncludingTrashed(roots, 101)).thenReturn(subtree);

        assertThat(resolver.forSpace(spaceId)).containsExactlyElementsOf(subtree);
        // One recursive walk for the whole root set, not one query per root on the
        // access-change request thread.
        verify(documentRepository).findSubtreesIncludingTrashed(roots, 101);
        verify(documentRepository, never()).findSubtreeIdsIncludingTrashed(any(UUID.class), anyInt());
    }

    @Test
    void anEmptySpaceExpandsToNothingWithoutAQuery() {
        UUID spaceId = UUID.randomUUID();
        when(documentRepository.findIdsBySpace_Id(spaceId)).thenReturn(List.of());

        assertThat(resolver.forSpace(spaceId)).isEmpty();
        verify(documentRepository, never()).findSubtreesIncludingTrashed(anyCollection(), anyInt());
    }
}
