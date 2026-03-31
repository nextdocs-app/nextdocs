package com.nextdocs.api.document.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.config.DocumentProperties;
import com.nextdocs.api.document.dto.request.DocumentUpdateRequest;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.entity.DocumentCollaborator;
import com.nextdocs.api.document.entity.DocumentGeneralAccessMode;
import com.nextdocs.api.document.repository.DocumentCollaboratorRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class DocumentServiceTest {

    @Mock
    private DocumentRepository documentRepository;

    @Mock
    private UserRepository userRepository;

    @Mock
    private DocumentCollaboratorRepository collaboratorRepository;

    private DocumentProperties documentProperties;

    private DocumentService documentService;

    @BeforeEach
    void setUp() {
        documentProperties = new DocumentProperties();
        documentProperties.setTrashRetentionDays(30);
        documentService =
                new DocumentService(documentRepository, collaboratorRepository, userRepository, documentProperties);
    }

    @Test
    void purgeExpiredTrash_deletesRowsOlderThanRetentionCutoff() {
        OffsetDateTime asOf = OffsetDateTime.of(2025, 6, 15, 12, 0, 0, 0, ZoneOffset.UTC);
        when(documentRepository.deleteExpiredTrash(any())).thenReturn(2);

        int purged = documentService.purgeExpiredTrash(asOf);

        assertEquals(2, purged);
        ArgumentCaptor<OffsetDateTime> cutoff = ArgumentCaptor.forClass(OffsetDateTime.class);
        verify(documentRepository).deleteExpiredTrash(cutoff.capture());
        assertEquals(OffsetDateTime.of(2025, 5, 16, 12, 0, 0, 0, ZoneOffset.UTC), cutoff.getValue());
    }

    @Test
    void get_allowsGeneralAccessWhenActiveLinkExists() {
        UUID requesterId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = createSharedDocument(documentId, DocumentAccessLevel.VIEW);

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(document));
        when(collaboratorRepository.findByDocument_IdAndUser_Id(documentId, requesterId))
                .thenReturn(Optional.empty());

        var response = documentService.get(requesterId, documentId, false);

        assertEquals(documentId, response.id());
        assertEquals("Shared doc", response.title());
    }

    @Test
    void update_allowsEditWhenGeneralAccessIsEdit() {
        UUID requesterId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = createSharedDocument(documentId, DocumentAccessLevel.EDIT);

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(document));
        when(collaboratorRepository.findByDocument_IdAndUser_Id(documentId, requesterId))
                .thenReturn(Optional.empty());
        when(documentRepository.save(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));

        var response =
                documentService.update(requesterId, documentId, new DocumentUpdateRequest("Updated title", null, null));

        assertEquals("Updated title", response.title());
    }

    @Test
    void update_returnsForbiddenWhenGeneralAccessIsReadOnly() {
        UUID requesterId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = createSharedDocument(documentId, DocumentAccessLevel.VIEW);

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(document));
        when(collaboratorRepository.findByDocument_IdAndUser_Id(documentId, requesterId))
                .thenReturn(Optional.empty());

        ApiException exception = assertThrows(
                ApiException.class,
                () -> documentService.update(
                        requesterId, documentId, new DocumentUpdateRequest("Updated title", null, null)));

        assertEquals(ErrorCode.FORBIDDEN, exception.getErrorCode());
        verify(documentRepository, never()).save(any(Document.class));
    }

    @Test
    void update_prefersCollaboratorReadOnlyOverGeneralEditAccess() {
        UUID requesterId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = createSharedDocument(documentId, DocumentAccessLevel.EDIT);

        DocumentCollaborator collaborator = DocumentCollaborator.builder()
                .document(document)
                .user(User.builder()
                        .id(requesterId)
                        .email("viewer@example.com")
                        .displayName("Viewer")
                        .build())
                .accessLevel(DocumentAccessLevel.VIEW)
                .build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(document));
        when(collaboratorRepository.findByDocument_IdAndUser_Id(documentId, requesterId))
                .thenReturn(Optional.of(collaborator));

        ApiException exception = assertThrows(
                ApiException.class,
                () -> documentService.update(
                        requesterId, documentId, new DocumentUpdateRequest("Updated title", null, null)));

        assertEquals(ErrorCode.FORBIDDEN, exception.getErrorCode());
        verify(documentRepository, never()).save(any(Document.class));
    }

    private static Document createSharedDocument(UUID documentId, DocumentAccessLevel linkAccessLevel) {
        User owner = User.builder()
                .id(UUID.randomUUID())
                .email("owner@example.com")
                .displayName("Owner")
                .build();

        return Document.builder()
                .id(documentId)
                .user(owner)
                .title("Shared doc")
                .yjsState("seed".getBytes(StandardCharsets.UTF_8))
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(linkAccessLevel)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .updatedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();
    }
}
