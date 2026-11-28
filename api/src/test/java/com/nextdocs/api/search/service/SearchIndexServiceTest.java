package com.nextdocs.api.search.service;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.nextdocs.api.search.config.SearchProperties;
import com.nextdocs.api.search.repository.DocumentSearchRepository;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class SearchIndexServiceTest {

    @Mock
    private SearchProperties properties;

    @Mock
    private DocumentSearchRepository repository;

    private SearchIndexService searchIndexService;

    @BeforeEach
    void setUp() {
        searchIndexService = new SearchIndexService(properties, repository);
    }

    @Test
    void disabledSearchAcceptsTheContentWithoutWriting() {
        UUID documentId = UUID.randomUUID();
        when(properties.isEnabled()).thenReturn(false);

        assertTrue(searchIndexService.indexContent(documentId, "hello", false, null, null));

        // The caller must not treat a disabled projection as a rejected payload: mentions
        // and the sort key still belong to this content update.
        verifyNoInteractions(repository);
    }

    @Test
    void writesTheProjectionAndReportsItAccepted() {
        UUID documentId = UUID.randomUUID();
        Instant producedAt = Instant.parse("2026-01-01T00:00:00Z");
        Instant indexedAt = Instant.parse("2026-01-01T00:00:01Z");
        when(properties.isEnabled()).thenReturn(true);
        when(repository.upsertContent(
                        eq(documentId),
                        eq("hello"),
                        eq(true),
                        eq(OffsetDateTime.ofInstant(producedAt, ZoneOffset.UTC)),
                        eq(OffsetDateTime.ofInstant(indexedAt, ZoneOffset.UTC))))
                .thenReturn(1);

        assertTrue(searchIndexService.indexContent(documentId, "hello", true, producedAt, indexedAt));
    }

    @Test
    void rejectedOlderProjectionReportsThatTheContentWasNotAccepted() {
        UUID documentId = UUID.randomUUID();
        when(properties.isEnabled()).thenReturn(true);
        when(repository.upsertContent(eq(documentId), any(), eq(false), any(), any()))
                .thenReturn(0);

        assertFalse(searchIndexService.indexContent(documentId, "old", false, null, null));
    }

    @Test
    void missingTextAndTimestampsUseEmptyContentAndTheCurrentInstant() {
        UUID documentId = UUID.randomUUID();
        when(properties.isEnabled()).thenReturn(true);
        when(repository.upsertContent(eq(documentId), eq(""), eq(false), any(), any()))
                .thenReturn(1);

        assertTrue(searchIndexService.indexContent(documentId, null, false, null, null));

        verify(repository).upsertContent(eq(documentId), eq(""), eq(false), any(), any());
    }
}
