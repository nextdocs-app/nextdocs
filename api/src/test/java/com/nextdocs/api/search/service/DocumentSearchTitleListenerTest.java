package com.nextdocs.api.search.service;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;

import com.nextdocs.api.search.event.DocumentSearchTitleChangedEvent;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class DocumentSearchTitleListenerTest {

    @Mock
    private SearchIndexService searchIndexService;

    @InjectMocks
    private DocumentSearchTitleListener listener;

    @Test
    void copiesTheCommittedTitleIntoTheProjection() {
        UUID documentId = UUID.randomUUID();

        listener.onTitleChanged(new DocumentSearchTitleChangedEvent(documentId));

        verify(searchIndexService).indexTitle(documentId);
    }

    @Test
    void swallowsAnIndexFailureSoTheWriterIsNotRolledBack() {
        UUID documentId = UUID.randomUUID();
        doThrow(new IllegalStateException("database unavailable"))
                .when(searchIndexService)
                .indexTitle(documentId);

        // Search is derived: a failure here must never surface to create/rename callers.
        assertThatCode(() -> listener.onTitleChanged(new DocumentSearchTitleChangedEvent(documentId)))
                .doesNotThrowAnyException();
    }
}
