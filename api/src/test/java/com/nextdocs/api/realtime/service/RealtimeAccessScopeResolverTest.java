package com.nextdocs.api.realtime.service;

import static org.assertj.core.api.Assertions.assertThat;
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
}
