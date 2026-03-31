package com.nextdocs.api.document.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.document.dto.request.CollaboratorUpsertRequest;
import com.nextdocs.api.document.dto.response.CollaboratorResponse;
import com.nextdocs.api.document.dto.response.DocumentAccessResponse;
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
class DocumentSharingServiceTest {

    @Mock
    private DocumentRepository documentRepository;

    @Mock
    private DocumentCollaboratorRepository collaboratorRepository;

    @Mock
    private UserRepository userRepository;

    private DocumentSharingService sharingService;

    @BeforeEach
    void setUp() {
        sharingService = new DocumentSharingService(documentRepository, collaboratorRepository, userRepository);
    }

    @Test
    void getMyAccess_allowsAnyoneWithLinkWhenGeneralAccessEnabled() {
        UUID requesterId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = createSharedDocument(documentId, DocumentAccessLevel.VIEW);

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(document));
        when(collaboratorRepository.findByDocument_IdAndUser_Id(documentId, requesterId))
                .thenReturn(Optional.empty());

        DocumentAccessResponse response = sharingService.getMyAccess(requesterId, documentId);

        assertTrue(response.allowed());
        assertEquals(DocumentAccessLevel.VIEW, response.accessLevel());
        assertFalse(response.owner());
    }

    @Test
    void getMyAccess_prefersCollaboratorAccessOverGeneralAccess() {
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

        DocumentAccessResponse response = sharingService.getMyAccess(requesterId, documentId);

        assertTrue(response.allowed());
        assertEquals(DocumentAccessLevel.VIEW, response.accessLevel());
        assertFalse(response.owner());
    }

    @Test
    void upsertCollaborator_usesPersistedCreatedAtWithoutManualOverride() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        User owner = User.builder()
                .id(ownerId)
                .email("owner@example.com")
                .displayName("Owner")
                .build();

        Document document = Document.builder()
                .id(documentId)
                .user(owner)
                .title("Shared doc")
                .yjsState("seed".getBytes(StandardCharsets.UTF_8))
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.VIEW)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .updatedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        User targetUser = User.builder()
                .id(UUID.randomUUID())
                .email("alice@example.com")
                .displayName("Alice")
                .build();

        when(documentRepository.findByIdAndUser_IdAndDeletedAtIsNull(documentId, ownerId))
                .thenReturn(Optional.of(document));
        when(userRepository.findByEmail("alice@example.com")).thenReturn(Optional.of(targetUser));
        when(collaboratorRepository.findByDocument_IdAndUser_Id(documentId, targetUser.getId()))
                .thenReturn(Optional.empty());
        OffsetDateTime persistedCreatedAt = OffsetDateTime.of(2026, 3, 1, 10, 0, 0, 0, ZoneOffset.UTC);
        when(collaboratorRepository.save(any(DocumentCollaborator.class))).thenAnswer(invocation -> {
            DocumentCollaborator input = invocation.getArgument(0);
            return DocumentCollaborator.builder()
                    .id(UUID.randomUUID())
                    .document(input.getDocument())
                    .user(input.getUser())
                    .accessLevel(input.getAccessLevel())
                    .grantedBy(input.getGrantedBy())
                    .createdAt(persistedCreatedAt)
                    .updatedAt(persistedCreatedAt)
                    .build();
        });

        CollaboratorResponse response = sharingService.upsertCollaborator(
                ownerId, documentId, new CollaboratorUpsertRequest("alice@example.com", DocumentAccessLevel.EDIT));

        ArgumentCaptor<DocumentCollaborator> collaboratorCaptor = ArgumentCaptor.forClass(DocumentCollaborator.class);
        verify(collaboratorRepository).save(collaboratorCaptor.capture());

        assertEquals(targetUser.getId(), response.userId());
        assertNull(collaboratorCaptor.getValue().getCreatedAt());
        assertEquals(persistedCreatedAt, response.addedAt());
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
