package com.nextdocs.api.document.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.dto.request.CollaboratorAccessUpdateRequest;
import com.nextdocs.api.document.dto.request.CollaboratorUpsertRequest;
import com.nextdocs.api.document.dto.request.SharingSettingsUpdateRequest;
import com.nextdocs.api.document.dto.response.CollaboratorResponse;
import com.nextdocs.api.document.dto.response.DocumentAccessResponse;
import com.nextdocs.api.document.dto.response.SharingSettingsResponse;
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

        when(permissionService.requireSharingAdminAccess(ownerId, documentId)).thenReturn(trashed);
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

        when(permissionService.requireReadAccessIncludingTrash(ownerId, documentId))
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

        when(permissionService.requireSharingAdminAccess(ownerId, documentId)).thenReturn(document);
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

        when(permissionService.requireSharingAdminAccess(ownerId, documentId)).thenReturn(document);
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
        Document document = Document.builder()
                .id(documentId)
                .user(User.builder().id(ownerId).build())
                .build();

        when(permissionService.requireSharingAdminAccess(ownerId, documentId)).thenReturn(document);
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

        when(permissionService.requireSharingAdminAccess(ownerId, documentId)).thenReturn(document);
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
    void upsertCollaborator_allowsOwnerLevelForCollaborators() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        User owner = User.builder().id(ownerId).email("owner@example.com").build();
        Document document = Document.builder().id(documentId).user(owner).build();
        User targetUser = User.builder()
                .id(UUID.randomUUID())
                .email("fullaccess@example.com")
                .build();

        when(permissionService.requireSharingAdminAccess(ownerId, documentId)).thenReturn(document);
        when(userRepository.findByEmail("fullaccess@example.com")).thenReturn(Optional.of(targetUser));
        when(collaboratorRepository.findByDocument_IdAndUser_Id(documentId, targetUser.getId()))
                .thenReturn(Optional.empty());
        when(userDocumentOrderRepository.existsByUser_IdAndDocument_Id(targetUser.getId(), documentId))
                .thenReturn(true);
        when(collaboratorRepository.save(any(DocumentCollaborator.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        CollaboratorResponse response = sharingService.upsertCollaborator(
                ownerId,
                documentId,
                new CollaboratorUpsertRequest("fullaccess@example.com", DocumentAccessLevel.OWNER));

        assertEquals(DocumentAccessLevel.OWNER, response.accessLevel());
        assertFalse(response.owner());
    }

    @Test
    void upsertCollaborator_actorDifferentFromDocOwner_setsGrantedByToActor() {
        UUID docOwnerId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        User docOwner = User.builder().id(docOwnerId).email("owner@example.com").build();
        Document document = Document.builder().id(documentId).user(docOwner).build();
        User actor = User.builder().id(actorId).email("actor@example.com").build();
        User targetUser =
                User.builder().id(UUID.randomUUID()).email("newbie@example.com").build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(document);
        when(userRepository.findByEmail("newbie@example.com")).thenReturn(Optional.of(targetUser));
        when(collaboratorRepository.findByDocument_IdAndUser_Id(documentId, targetUser.getId()))
                .thenReturn(Optional.empty());
        when(userRepository.findById(actorId)).thenReturn(Optional.of(actor));
        when(userDocumentOrderRepository.existsByUser_IdAndDocument_Id(targetUser.getId(), documentId))
                .thenReturn(true);
        when(collaboratorRepository.save(any(DocumentCollaborator.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        CollaboratorResponse response = sharingService.upsertCollaborator(
                actorId, documentId, new CollaboratorUpsertRequest("newbie@example.com", DocumentAccessLevel.VIEW));

        ArgumentCaptor<DocumentCollaborator> captor = ArgumentCaptor.forClass(DocumentCollaborator.class);
        verify(collaboratorRepository).save(captor.capture());
        assertEquals(actorId, captor.getValue().getGrantedBy().getId());
        assertEquals(targetUser.getId(), response.userId());
        assertFalse(response.owner());
    }

    @Test
    void upsertCollaborator_targetIsDocumentOwner_throwsConflict() {
        UUID docOwnerId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        User docOwner = User.builder().id(docOwnerId).email("owner@example.com").build();
        Document document = Document.builder().id(documentId).user(docOwner).build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(document);
        when(userRepository.findByEmail("owner@example.com")).thenReturn(Optional.of(docOwner));

        ApiException ex = assertThrows(
                ApiException.class,
                () -> sharingService.upsertCollaborator(
                        actorId,
                        documentId,
                        new CollaboratorUpsertRequest("owner@example.com", DocumentAccessLevel.EDIT)));
        assertEquals(ErrorCode.CONFLICT, ex.getErrorCode());
    }

    @Test
    void upsertCollaborator_targetIsActor_throwsConflict() {
        UUID docOwnerId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        User docOwner = User.builder().id(docOwnerId).email("owner@example.com").build();
        Document document = Document.builder().id(documentId).user(docOwner).build();
        User actor = User.builder().id(actorId).email("actor@example.com").build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(document);
        when(userRepository.findByEmail("actor@example.com")).thenReturn(Optional.of(actor));

        ApiException ex = assertThrows(
                ApiException.class,
                () -> sharingService.upsertCollaborator(
                        actorId,
                        documentId,
                        new CollaboratorUpsertRequest("actor@example.com", DocumentAccessLevel.EDIT)));
        assertEquals(ErrorCode.CONFLICT, ex.getErrorCode());
    }

    @Test
    void updateCollaboratorAccess_targetIsDocumentOwner_throwsConflict() {
        UUID docOwnerId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = Document.builder()
                .id(documentId)
                .user(User.builder().id(docOwnerId).build())
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(document);

        ApiException ex = assertThrows(
                ApiException.class,
                () -> sharingService.updateCollaboratorAccess(
                        actorId,
                        documentId,
                        docOwnerId,
                        new CollaboratorAccessUpdateRequest(DocumentAccessLevel.VIEW)));
        assertEquals(ErrorCode.CONFLICT, ex.getErrorCode());
    }

    @Test
    void updateCollaboratorAccess_targetIsActor_throwsConflict() {
        UUID docOwnerId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = Document.builder()
                .id(documentId)
                .user(User.builder().id(docOwnerId).build())
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(document);

        ApiException ex = assertThrows(
                ApiException.class,
                () -> sharingService.updateCollaboratorAccess(
                        actorId, documentId, actorId, new CollaboratorAccessUpdateRequest(DocumentAccessLevel.VIEW)));
        assertEquals(ErrorCode.CONFLICT, ex.getErrorCode());
    }

    @Test
    void removeCollaborator_targetIsDocumentOwner_throwsConflict() {
        UUID docOwnerId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = Document.builder()
                .id(documentId)
                .user(User.builder().id(docOwnerId).build())
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(document);

        ApiException ex = assertThrows(
                ApiException.class, () -> sharingService.removeCollaborator(actorId, documentId, docOwnerId));
        assertEquals(ErrorCode.CONFLICT, ex.getErrorCode());
    }

    @Test
    void removeCollaborator_targetIsActor_throwsConflict() {
        UUID docOwnerId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = Document.builder()
                .id(documentId)
                .user(User.builder().id(docOwnerId).build())
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(document);

        ApiException ex =
                assertThrows(ApiException.class, () -> sharingService.removeCollaborator(actorId, documentId, actorId));
        assertEquals(ErrorCode.CONFLICT, ex.getErrorCode());
    }

    @Test
    void listCollaborators_setsOwnerFlagTrueForDocOwnerAndFalseForCollaborators() {
        UUID ownerId = UUID.randomUUID();
        UUID collabOwnerRoleId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        User docOwner = User.builder()
                .id(ownerId)
                .email("owner@example.com")
                .displayName("Doc Owner")
                .build();
        Document doc = Document.builder()
                .id(documentId)
                .user(docOwner)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        User collabUser = User.builder()
                .id(collabOwnerRoleId)
                .email("collab@example.com")
                .displayName("Collab Owner")
                .build();
        DocumentCollaborator collaborator = DocumentCollaborator.builder()
                .id(UUID.randomUUID())
                .document(doc)
                .user(collabUser)
                .accessLevel(DocumentAccessLevel.OWNER)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(permissionService.requireReadAccessIncludingTrash(ownerId, documentId))
                .thenReturn(doc);
        when(collaboratorRepository.findAllByDocument_Id(documentId)).thenReturn(List.of(collaborator));

        List<CollaboratorResponse> result = sharingService.listCollaborators(ownerId, documentId);

        assertEquals(2, result.size());
        assertTrue(result.get(0).owner());
        assertEquals(ownerId, result.get(0).userId());
        assertFalse(result.get(1).owner());
        assertEquals(collabOwnerRoleId, result.get(1).userId());
        assertEquals(DocumentAccessLevel.OWNER, result.get(1).accessLevel());
    }

    @Test
    void getSharingSettings_andUpdate_forFullAccessCollaborator_succeeds() {
        UUID docOwnerId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = Document.builder()
                .id(documentId)
                .user(User.builder().id(docOwnerId).build())
                .generalAccessMode(DocumentGeneralAccessMode.RESTRICTED)
                .linkAccessLevel(DocumentAccessLevel.VIEW)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(document);

        SharingSettingsResponse getResponse = sharingService.getSharingSettings(actorId, documentId);
        assertEquals(DocumentGeneralAccessMode.RESTRICTED, getResponse.generalAccessMode());
        assertFalse(getResponse.hasActiveLink());

        when(documentRepository.save(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));

        SharingSettingsResponse updateResponse = sharingService.updateSharingSettings(
                actorId,
                documentId,
                new SharingSettingsUpdateRequest(DocumentGeneralAccessMode.ANYONE_WITH_LINK, DocumentAccessLevel.EDIT));

        assertEquals(DocumentGeneralAccessMode.ANYONE_WITH_LINK, updateResponse.generalAccessMode());
        assertEquals(DocumentAccessLevel.EDIT, updateResponse.linkAccessLevel());
        assertTrue(updateResponse.hasActiveLink());
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
