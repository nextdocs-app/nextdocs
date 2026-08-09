package com.nextdocs.api.document.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.document.dto.request.CollaboratorUpsertRequest;
import com.nextdocs.api.document.dto.response.CollaboratorResponse;
import com.nextdocs.api.document.dto.response.DocumentAccessResponse;
import com.nextdocs.api.document.dto.response.DocumentResponse;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.entity.DocumentCollaborator;
import com.nextdocs.api.document.entity.DocumentGeneralAccessMode;
import com.nextdocs.api.document.entity.UserDocumentOrder;
import com.nextdocs.api.document.repository.DocumentCollaboratorRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.repository.UserDocumentOrderRepository;
import java.nio.charset.StandardCharsets;
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
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;

@ExtendWith(MockitoExtension.class)
class DocumentSharingServiceTest {

    @Mock
    private DocumentRepository documentRepository;

    @Mock
    private DocumentCollaboratorRepository collaboratorRepository;

    @Mock
    private UserDocumentOrderRepository userDocumentOrderRepository;

    @Mock
    private UserRepository userRepository;

    @Mock
    private PermissionService permissionService;

    private DocumentSharingService sharingService;

    @BeforeEach
    void setUp() {
        sharingService = new DocumentSharingService(
                documentRepository,
                collaboratorRepository,
                userDocumentOrderRepository,
                userRepository,
                permissionService);
    }

    @Test
    void getMyAccess_allowsAnyoneWithLinkWhenGeneralAccessEnabled() {
        UUID requesterId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = createSharedDocument(documentId, DocumentAccessLevel.VIEW);

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(document));
        when(permissionService.resolveAccess(requesterId, documentId)).thenReturn(DocumentAccessLevel.VIEW);

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

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(document));
        when(permissionService.resolveAccess(requesterId, documentId)).thenReturn(DocumentAccessLevel.VIEW);

        DocumentAccessResponse response = sharingService.getMyAccess(requesterId, documentId);

        assertTrue(response.allowed());
        assertEquals(DocumentAccessLevel.VIEW, response.accessLevel());
        assertFalse(response.owner());
    }

    @Test
    void getMyAccess_onTrashedDocument_reportsPreTrashAccessAndTrashFlag() {
        UUID viewerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.empty());
        when(permissionService.resolveTrashAccess(viewerId, documentId)).thenReturn(DocumentAccessLevel.COMMENT);

        DocumentAccessResponse response = sharingService.getMyAccess(viewerId, documentId);

        assertTrue(response.allowed());
        assertTrue(response.trashed());
        assertEquals(DocumentAccessLevel.COMMENT, response.accessLevel());
        assertFalse(response.owner());
    }

    @Test
    void getMyAccess_onTrashedDocumentWithoutAnyAccess_denies() {
        UUID strangerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.empty());
        when(permissionService.resolveTrashAccess(strangerId, documentId)).thenReturn(null);

        DocumentAccessResponse response = sharingService.getMyAccess(strangerId, documentId);

        assertFalse(response.allowed());
        assertTrue(response.trashed());
        assertNull(response.accessLevel());
    }

    @Test
    void accessCheck_onTrashedDocument_deniedEvenForOwner() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.empty());

        DocumentAccessResponse response = sharingService.accessCheck(ownerId, documentId);

        assertFalse(response.allowed());
        assertTrue(response.trashed());
        assertNull(response.accessLevel());
    }

    @Test
    void removeCollaborator_onTrashedDocument_allowsOwner() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID collaboratorUserId = UUID.randomUUID();
        Document trashed = Document.builder()
                .id(documentId)
                .user(User.builder().id(ownerId).build())
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(permissionService.requireOwnerAccessIncludingTrash(ownerId, documentId))
                .thenReturn(trashed);

        when(permissionService.requireOwnerAccessIncludingTrash(ownerId, documentId))
                .thenReturn(trashed);
        when(collaboratorRepository.existsByDocument_IdAndUser_Id(documentId, collaboratorUserId))
                .thenReturn(true);

        sharingService.removeCollaborator(ownerId, documentId, collaboratorUserId);

        verify(collaboratorRepository).deleteByDocument_IdAndUser_Id(documentId, collaboratorUserId);
        verify(userDocumentOrderRepository).deleteByUser_IdAndDocument_Id(collaboratorUserId, documentId);
    }

    @Test
    void listCollaborators_onTrashedDocument_allowsOwner() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document trashed = Document.builder()
                .id(documentId)
                .user(User.builder()
                        .id(ownerId)
                        .email("owner@example.com")
                        .displayName("Owner")
                        .build())
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(permissionService.requireReadAccessOrTrashOwner(ownerId, documentId))
                .thenReturn(trashed);
        when(collaboratorRepository.findAllByDocument_Id(documentId)).thenReturn(List.of());

        List<CollaboratorResponse> result = sharingService.listCollaborators(ownerId, documentId);

        assertEquals(1, result.size());
        assertEquals(DocumentAccessLevel.OWNER, result.get(0).accessLevel());
    }

    @Test
    void upsertCollaborator_createsUserDocumentOrderForRootDocument() {
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

        when(permissionService.requireOwnerAccessIncludingTrash(ownerId, documentId))
                .thenReturn(document);
        when(userRepository.findByEmail("alice@example.com")).thenReturn(Optional.of(targetUser));
        when(collaboratorRepository.findByDocument_IdAndUser_Id(documentId, targetUser.getId()))
                .thenReturn(Optional.empty());
        when(userDocumentOrderRepository.existsByUser_IdAndDocument_Id(targetUser.getId(), documentId))
                .thenReturn(false);
        when(userDocumentOrderRepository.findMinOrderKeyByUserId(targetUser.getId(), documentId))
                .thenReturn(Optional.of("a5"));

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

        ArgumentCaptor<UserDocumentOrder> orderCaptor = ArgumentCaptor.forClass(UserDocumentOrder.class);
        verify(userDocumentOrderRepository).saveAndFlush(orderCaptor.capture());
        assertTrue(orderCaptor.getValue().getOrderKey().compareTo("a5") < 0);

        assertEquals(targetUser.getId(), response.userId());
        assertNull(collaboratorCaptor.getValue().getCreatedAt());
        assertEquals(persistedCreatedAt, response.addedAt());
    }

    @Test
    void upsertCollaborator_retriesWhenOrderRowInsertCollides() {
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
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .updatedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        User targetUser = User.builder()
                .id(UUID.randomUUID())
                .email("alice@example.com")
                .displayName("Alice")
                .build();

        when(permissionService.requireOwnerAccessIncludingTrash(ownerId, documentId))
                .thenReturn(document);
        when(userRepository.findByEmail("alice@example.com")).thenReturn(Optional.of(targetUser));
        when(collaboratorRepository.findByDocument_IdAndUser_Id(documentId, targetUser.getId()))
                .thenReturn(Optional.empty());
        when(userDocumentOrderRepository.existsByUser_IdAndDocument_Id(targetUser.getId(), documentId))
                .thenReturn(false);
        when(userDocumentOrderRepository.findMinOrderKeyByUserId(targetUser.getId(), documentId))
                .thenReturn(Optional.of("a5"));
        when(collaboratorRepository.save(any(DocumentCollaborator.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));
        when(userDocumentOrderRepository.saveAndFlush(any(UserDocumentOrder.class)))
                .thenThrow(new DataIntegrityViolationException("order_key unique violation"))
                .thenAnswer(invocation -> invocation.getArgument(0));

        sharingService.upsertCollaborator(
                ownerId, documentId, new CollaboratorUpsertRequest("alice@example.com", DocumentAccessLevel.EDIT));

        verify(userDocumentOrderRepository, times(2)).saveAndFlush(any(UserDocumentOrder.class));
    }

    @Test
    void removeCollaborator_deletesCollaboratorAndUserDocumentOrder() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID collaboratorId = UUID.randomUUID();

        when(collaboratorRepository.existsByDocument_IdAndUser_Id(documentId, collaboratorId))
                .thenReturn(true);

        sharingService.removeCollaborator(ownerId, documentId, collaboratorId);

        verify(collaboratorRepository).deleteByDocument_IdAndUser_Id(documentId, collaboratorId);
        verify(userDocumentOrderRepository).deleteByUser_IdAndDocument_Id(collaboratorId, documentId);
    }

    @Test
    void upsertCollaborator_createsUserDocumentOrderForNestedDocument() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        User owner = User.builder()
                .id(ownerId)
                .email("owner@example.com")
                .displayName("Owner")
                .build();

        Document parent = Document.builder()
                .id(UUID.randomUUID())
                .user(owner)
                .title("Parent")
                .build();
        Document document = Document.builder()
                .id(documentId)
                .user(owner)
                .title("Nested shared doc")
                .parent(parent)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .updatedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        User targetUser = User.builder()
                .id(UUID.randomUUID())
                .email("alice@example.com")
                .displayName("Alice")
                .build();

        when(permissionService.requireOwnerAccessIncludingTrash(ownerId, documentId))
                .thenReturn(document);
        when(userRepository.findByEmail("alice@example.com")).thenReturn(Optional.of(targetUser));
        when(collaboratorRepository.findByDocument_IdAndUser_Id(documentId, targetUser.getId()))
                .thenReturn(Optional.empty());
        when(userDocumentOrderRepository.existsByUser_IdAndDocument_Id(targetUser.getId(), documentId))
                .thenReturn(false);
        when(userDocumentOrderRepository.findMinOrderKeyByUserId(targetUser.getId(), documentId))
                .thenReturn(Optional.of("a5"));
        when(collaboratorRepository.save(any(DocumentCollaborator.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        sharingService.upsertCollaborator(
                ownerId, documentId, new CollaboratorUpsertRequest("alice@example.com", DocumentAccessLevel.EDIT));

        ArgumentCaptor<UserDocumentOrder> orderCaptor = ArgumentCaptor.forClass(UserDocumentOrder.class);
        verify(userDocumentOrderRepository).saveAndFlush(orderCaptor.capture());
        assertTrue(orderCaptor.getValue().getOrderKey().compareTo("a5") < 0);
    }

    @Test
    void listSharedWithMe_returnsUserNavOrderKeyForRootDocuments() {
        UUID userId = UUID.randomUUID();
        User owner = User.builder().id(UUID.randomUUID()).build();

        Document rootDoc = Document.builder()
                .id(UUID.randomUUID())
                .user(owner)
                .title("Shared root")
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .updatedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        Document parent = Document.builder()
                .id(UUID.randomUUID())
                .user(owner)
                .title("Parent")
                .build();
        Document nestedDoc = Document.builder()
                .id(UUID.randomUUID())
                .user(owner)
                .title("Shared nested")
                .parent(parent)
                .siblingOrderKey("c0")
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .updatedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        Pageable pageable = PageRequest.of(0, 50);
        Page<Document> page = new PageImpl<>(List.of(rootDoc, nestedDoc));

        when(documentRepository.findSharedWithUserId(userId, pageable)).thenReturn(page);
        when(userDocumentOrderRepository.findOrderKeysByUserIdAndDocumentIds(eq(userId), any()))
                .thenReturn(List.<Object[]>of(new Object[] {rootDoc.getId(), "a0"}));

        Page<DocumentResponse> result = sharingService.listSharedWithMe(userId, pageable);

        assertEquals("a0", result.getContent().get(0).orderKey());
        assertNull(result.getContent().get(0).parentId());
        assertEquals("c0", result.getContent().get(1).orderKey());
        assertEquals(parent.getId(), result.getContent().get(1).parentId());
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
