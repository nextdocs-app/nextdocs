package com.nextdocs.api.document.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.dto.response.DocumentViewerResponse;
import com.nextdocs.api.document.entity.DocumentView;
import com.nextdocs.api.document.repository.DocumentViewRepository;
import com.nextdocs.api.user.entity.User;
import com.nextdocs.api.user.repository.UserRepository;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.QueryTimeoutException;

@ExtendWith(MockitoExtension.class)
class DocumentViewServiceTest {

    @Mock
    private DocumentViewRepository repository;

    @Mock
    private UserRepository userRepository;

    @Mock
    private PermissionService permissionService;

    private DocumentViewService service;

    private UUID documentId;
    private UUID userId;

    @BeforeEach
    void setUp() {
        service = new DocumentViewService(repository, userRepository, permissionService);
        documentId = UUID.randomUUID();
        userId = UUID.randomUUID();
    }

    @Test
    void recordView_firstVisit_insertsRow() {
        when(repository.findByDocumentIdAndUserId(documentId, userId)).thenReturn(Optional.empty());
        when(repository.save(any(DocumentView.class))).thenAnswer(invocation -> invocation.getArgument(0));

        service.recordView(documentId, userId);

        ArgumentCaptor<DocumentView> saved = ArgumentCaptor.forClass(DocumentView.class);
        verify(repository).save(saved.capture());
        assertEquals(documentId, saved.getValue().getDocumentId());
        assertEquals(userId, saved.getValue().getUserId());
        assertNotNull(saved.getValue().getLastViewedAt());
        assertEquals(ZoneOffset.UTC, saved.getValue().getLastViewedAt().getOffset());
    }

    @Test
    void recordView_returnVisit_refreshesLastViewedAt() {
        DocumentView existing = DocumentView.builder()
                .id(UUID.randomUUID())
                .documentId(documentId)
                .userId(userId)
                .lastViewedAt(OffsetDateTime.now(ZoneOffset.UTC).minusDays(2))
                .build();
        OffsetDateTime previous = existing.getLastViewedAt();
        when(repository.findByDocumentIdAndUserId(documentId, userId)).thenReturn(Optional.of(existing));
        when(repository.save(existing)).thenReturn(existing);

        service.recordView(documentId, userId);

        assertTrue(existing.getLastViewedAt().isAfter(previous));
        verify(repository).save(existing);
    }

    @Test
    void recordView_writeFailure_isSwallowed() {
        when(repository.findByDocumentIdAndUserId(documentId, userId)).thenThrow(new QueryTimeoutException("boom"));

        service.recordView(documentId, userId);

        verify(repository).findByDocumentIdAndUserId(documentId, userId);
    }

    @Test
    void viewers_noHistory_readsNoAccounts() {
        when(repository.findTop50ByDocumentIdOrderByLastViewedAtDescIdAsc(documentId))
                .thenReturn(List.of());

        assertTrue(service.viewers(userId, documentId).isEmpty());

        verify(permissionService).requireReadAccessIncludingTrash(userId, documentId);
        verifyNoInteractions(userRepository);
    }

    @Test
    void viewers_keepsHistoryOrderAndNamesEachPerson() {
        UUID secondUserId = UUID.randomUUID();
        OffsetDateTime recent = OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(5);
        OffsetDateTime older = OffsetDateTime.now(ZoneOffset.UTC).minusHours(3);
        when(repository.findTop50ByDocumentIdOrderByLastViewedAtDescIdAsc(documentId))
                .thenReturn(List.of(
                        DocumentView.builder()
                                .documentId(documentId)
                                .userId(secondUserId)
                                .lastViewedAt(recent)
                                .build(),
                        DocumentView.builder()
                                .documentId(documentId)
                                .userId(userId)
                                .lastViewedAt(older)
                                .build()));
        when(userRepository.findAllById(List.of(secondUserId, userId)))
                .thenReturn(List.of(
                        User.builder()
                                .id(userId)
                                .email("ada@example.com")
                                .displayName("Ada")
                                .passwordHash("$2a$12$hash")
                                .build(),
                        User.builder()
                                .id(secondUserId)
                                .email("bob@example.com")
                                .displayName("Bob")
                                .passwordHash("$2a$12$hash")
                                .build()));

        List<DocumentViewerResponse> viewers = service.viewers(userId, documentId);

        assertEquals(2, viewers.size());
        assertEquals(secondUserId, viewers.get(0).userId());
        assertEquals("Bob", viewers.get(0).displayName());
        assertEquals(recent, viewers.get(0).lastViewedAt());
        assertEquals("Ada", viewers.get(1).displayName());
        assertEquals(older, viewers.get(1).lastViewedAt());
        // The rows name a person without exposing contact details: this is history,
        // not the sharing roster.
        assertNull(viewers.get(0).avatarUrl());
    }

    @Test
    void viewers_notReadable_readsNoHistory() {
        when(permissionService.requireReadAccessIncludingTrash(userId, documentId))
                .thenThrow(new ApiException(ErrorCode.NOT_FOUND));

        assertThrows(ApiException.class, () -> service.viewers(userId, documentId));

        verify(repository, never()).findTop50ByDocumentIdOrderByLastViewedAtDescIdAsc(any());
        verifyNoInteractions(userRepository);
    }
}
