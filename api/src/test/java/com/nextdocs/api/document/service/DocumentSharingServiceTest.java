package com.nextdocs.api.document.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
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
    void upsertCollaborator_ancestorOwner_createsDirectOverrideRow() {
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID ancestorDocId = UUID.randomUUID();
        User actor = User.builder().id(actorId).email("owner@example.com").build();
        User ancestorOwner = User.builder()
                .id(UUID.randomUUID())
                .email("ancestor@example.com")
                .build();
        Document ancestor = Document.builder()
                .id(ancestorDocId)
                .user(ancestorOwner)
                .title("Ancestor")
                .build();
        Document document =
                Document.builder().id(documentId).user(actor).parent(ancestor).build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(document);
        when(userRepository.findByEmail("ancestor@example.com")).thenReturn(Optional.of(ancestorOwner));
        when(collaboratorRepository.findByDocument_IdAndUser_Id(documentId, ancestorOwner.getId()))
                .thenReturn(Optional.empty());
        when(userDocumentOrderRepository.findMinOrderKeyByUserId(ancestorOwner.getId(), documentId))
                .thenReturn(Optional.empty());
        when(collaboratorRepository.save(any(DocumentCollaborator.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        sharingService.upsertCollaborator(
                actorId, documentId, new CollaboratorUpsertRequest("ancestor@example.com", DocumentAccessLevel.VIEW));

        ArgumentCaptor<DocumentCollaborator> captor = ArgumentCaptor.forClass(DocumentCollaborator.class);
        verify(collaboratorRepository).save(captor.capture());
        assertEquals(DocumentAccessLevel.VIEW, captor.getValue().getAccessLevel());
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

    @Test
    void listCollaborators_withAncestors_includesDirectAndInheritedCollaboratorsWithSourceDetails() {
        UUID ownerId = UUID.randomUUID();
        UUID childDocId = UUID.randomUUID();
        UUID parentDocId = UUID.randomUUID();

        User owner = User.builder()
                .id(ownerId)
                .email("owner@example.com")
                .displayName("Owner")
                .build();

        Document parent = Document.builder()
                .id(parentDocId)
                .user(owner)
                .title("Parent Page")
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        Document child = Document.builder()
                .id(childDocId)
                .user(owner)
                .parent(parent)
                .title("Child Page")
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        UUID directCollabUserId = UUID.randomUUID();
        User directCollabUser = User.builder()
                .id(directCollabUserId)
                .email("direct@example.com")
                .displayName("Direct Collab")
                .build();
        DocumentCollaborator directCollab = DocumentCollaborator.builder()
                .id(UUID.randomUUID())
                .document(child)
                .user(directCollabUser)
                .accessLevel(DocumentAccessLevel.EDIT)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        UUID parentCollabUserId = UUID.randomUUID();
        User parentCollabUser = User.builder()
                .id(parentCollabUserId)
                .email("parentcollab@example.com")
                .displayName("Parent Collab")
                .build();
        DocumentCollaborator parentCollab = DocumentCollaborator.builder()
                .id(UUID.randomUUID())
                .document(parent)
                .user(parentCollabUser)
                .accessLevel(DocumentAccessLevel.VIEW)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(permissionService.requireReadAccessIncludingTrash(ownerId, childDocId))
                .thenReturn(child);
        when(collaboratorRepository.findAllByDocument_Id(childDocId)).thenReturn(List.of(directCollab));
        when(collaboratorRepository.findAllByDocument_Id(parentDocId)).thenReturn(List.of(parentCollab));

        List<CollaboratorResponse> result = sharingService.listCollaborators(ownerId, childDocId);

        assertEquals(3, result.size());

        // 1. Direct owner
        CollaboratorResponse ownerResp = result.get(0);
        assertEquals(ownerId, ownerResp.userId());
        assertTrue(ownerResp.owner());
        assertFalse(ownerResp.inherited());
        assertNull(ownerResp.inheritedFromId());

        // 2. Direct collaborator on child
        CollaboratorResponse directResp = result.get(1);
        assertEquals(directCollabUserId, directResp.userId());
        assertFalse(directResp.owner());
        assertFalse(directResp.inherited());
        assertNull(directResp.inheritedFromId());

        // 3. Inherited collaborator from parent
        CollaboratorResponse inheritedResp = result.get(2);
        assertEquals(parentCollabUserId, inheritedResp.userId());
        assertFalse(inheritedResp.owner());
        assertTrue(inheritedResp.inherited());
        assertEquals(parentDocId, inheritedResp.inheritedFromId());
        assertEquals("Parent Page", inheritedResp.inheritedFromTitle());
    }

    @Test
    void getSharingSettings_withAncestorPublicLink_returnsInheritedSettings() {
        UUID actorId = UUID.randomUUID();
        UUID childDocId = UUID.randomUUID();
        UUID parentDocId = UUID.randomUUID();

        User owner = User.builder().id(actorId).build();

        Document parent = Document.builder()
                .id(parentDocId)
                .user(owner)
                .title("Parent Wiki")
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.VIEW)
                .build();

        Document child = Document.builder()
                .id(childDocId)
                .user(owner)
                .parent(parent)
                .generalAccessMode(DocumentGeneralAccessMode.RESTRICTED)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, childDocId)).thenReturn(child);

        SharingSettingsResponse response = sharingService.getSharingSettings(actorId, childDocId);

        assertEquals(DocumentGeneralAccessMode.RESTRICTED, response.generalAccessMode());
        assertEquals(DocumentAccessLevel.VIEW, response.linkAccessLevel());
        assertFalse(response.hasActiveLink());
        assertTrue(response.inherited());
        assertEquals(parentDocId, response.inheritedFromId());
        assertEquals("Parent Wiki", response.inheritedFromTitle());
    }

    @Test
    void getSharingSettings_withAncestorPublicLink_usesAncestorLinkLevelOverStaleChildLevel() {
        UUID actorId = UUID.randomUUID();
        UUID childDocId = UUID.randomUUID();
        UUID parentDocId = UUID.randomUUID();

        User owner = User.builder().id(actorId).build();

        Document parent = Document.builder()
                .id(parentDocId)
                .user(owner)
                .title("Parent Wiki")
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.VIEW)
                .build();

        Document child = Document.builder()
                .id(childDocId)
                .user(owner)
                .parent(parent)
                .generalAccessMode(DocumentGeneralAccessMode.RESTRICTED)
                // Stale level from a time when the child itself was public; it must not win.
                .linkAccessLevel(DocumentAccessLevel.EDIT)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, childDocId)).thenReturn(child);

        SharingSettingsResponse response = sharingService.getSharingSettings(actorId, childDocId);

        assertEquals(DocumentAccessLevel.VIEW, response.linkAccessLevel());
        assertTrue(response.inherited());
        assertEquals(parentDocId, response.inheritedFromId());
    }

    @Test
    void getSharingSettings_withTrashedAncestor_doesNotInheritFromLiveGrandparent() {
        UUID actorId = UUID.randomUUID();
        UUID childDocId = UUID.randomUUID();
        UUID trashedParentDocId = UUID.randomUUID();
        UUID grandparentDocId = UUID.randomUUID();

        User owner = User.builder().id(actorId).build();

        Document grandparent = Document.builder()
                .id(grandparentDocId)
                .user(owner)
                .title("Grandparent Wiki")
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.EDIT)
                .build();

        Document trashedParent = Document.builder()
                .id(trashedParentDocId)
                .user(owner)
                .title("Trashed Parent")
                .parent(grandparent)
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.VIEW)
                .build();

        Document child = Document.builder()
                .id(childDocId)
                .user(owner)
                .parent(trashedParent)
                .generalAccessMode(DocumentGeneralAccessMode.RESTRICTED)
                .linkAccessLevel(DocumentAccessLevel.COMMENT)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, childDocId)).thenReturn(child);

        SharingSettingsResponse response = sharingService.getSharingSettings(actorId, childDocId);

        assertFalse(response.inherited());
        assertNull(response.inheritedFromId());
        assertNull(response.inheritedFromTitle());
        assertEquals(DocumentAccessLevel.COMMENT, response.linkAccessLevel());
    }

    @Test
    void listCollaborators_withDirectOverride_includesInheritedSourceDetails() {
        UUID ownerId = UUID.randomUUID();
        UUID childDocId = UUID.randomUUID();
        UUID parentDocId = UUID.randomUUID();

        User owner = User.builder().id(ownerId).email("owner@example.com").build();
        Document parent = Document.builder()
                .id(parentDocId)
                .user(owner)
                .title("Parent Doc")
                .build();
        Document child = Document.builder()
                .id(childDocId)
                .user(owner)
                .parent(parent)
                .title("Child Doc")
                .build();

        UUID bobId = UUID.randomUUID();
        User bob = User.builder().id(bobId).email("bob@example.com").build();

        DocumentCollaborator directCollab = DocumentCollaborator.builder()
                .id(UUID.randomUUID())
                .document(child)
                .user(bob)
                .accessLevel(DocumentAccessLevel.VIEW)
                .build();

        DocumentCollaborator parentCollab = DocumentCollaborator.builder()
                .id(UUID.randomUUID())
                .document(parent)
                .user(bob)
                .accessLevel(DocumentAccessLevel.EDIT)
                .build();

        when(permissionService.requireReadAccessIncludingTrash(ownerId, childDocId))
                .thenReturn(child);
        when(collaboratorRepository.findAllByDocument_Id(childDocId)).thenReturn(List.of(directCollab));
        when(collaboratorRepository.findAllByDocument_Id(parentDocId)).thenReturn(List.of(parentCollab));
        when(collaboratorRepository.hasPositiveAncestorGrant(bobId, childDocId)).thenReturn(true);

        List<CollaboratorResponse> result = sharingService.listCollaborators(ownerId, childDocId);

        assertEquals(2, result.size());
        CollaboratorResponse bobResp = result.get(1);
        assertEquals(bobId, bobResp.userId());
        assertEquals(DocumentAccessLevel.VIEW, bobResp.accessLevel());
        assertFalse(bobResp.inherited());
        assertEquals(parentDocId, bobResp.inheritedFromId());
        assertEquals("Parent Doc", bobResp.inheritedFromTitle());
        assertEquals(DocumentAccessLevel.EDIT, bobResp.inheritedAccessLevel());
    }

    @Test
    void listCollaborators_withInterveningNoAccess_omitsBlockedAncestor() {
        UUID ownerId = UUID.randomUUID();
        UUID childDocId = UUID.randomUUID();
        UUID parentDocId = UUID.randomUUID();
        UUID grandparentDocId = UUID.randomUUID();

        User owner = User.builder().id(ownerId).email("owner@example.com").build();
        Document grandparent = Document.builder()
                .id(grandparentDocId)
                .user(owner)
                .title("Grandparent")
                .build();
        Document parent = Document.builder()
                .id(parentDocId)
                .user(owner)
                .parent(grandparent)
                .title("Parent")
                .build();
        Document child = Document.builder()
                .id(childDocId)
                .user(owner)
                .parent(parent)
                .title("Child")
                .build();

        UUID bobId = UUID.randomUUID();
        User bob = User.builder().id(bobId).email("bob@example.com").build();

        DocumentCollaborator parentNoAccess = DocumentCollaborator.builder()
                .id(UUID.randomUUID())
                .document(parent)
                .user(bob)
                .accessLevel(DocumentAccessLevel.NO_ACCESS)
                .build();

        DocumentCollaborator grandparentEdit = DocumentCollaborator.builder()
                .id(UUID.randomUUID())
                .document(grandparent)
                .user(bob)
                .accessLevel(DocumentAccessLevel.EDIT)
                .build();

        when(permissionService.requireReadAccessIncludingTrash(ownerId, childDocId))
                .thenReturn(child);
        when(collaboratorRepository.findAllByDocument_Id(childDocId)).thenReturn(List.of());
        when(collaboratorRepository.findAllByDocument_Id(parentDocId)).thenReturn(List.of(parentNoAccess));
        when(collaboratorRepository.findAllByDocument_Id(grandparentDocId)).thenReturn(List.of(grandparentEdit));

        List<CollaboratorResponse> result = sharingService.listCollaborators(ownerId, childDocId);

        assertEquals(1, result.size());
        assertEquals(ownerId, result.get(0).userId());
    }

    @Test
    void upsertCollaborator_withNoAccess_throwsValidationFailed() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = Document.builder()
                .id(documentId)
                .user(User.builder().id(ownerId).build())
                .build();

        when(permissionService.requireSharingAdminAccess(ownerId, documentId)).thenReturn(document);

        ApiException ex = assertThrows(
                ApiException.class,
                () -> sharingService.upsertCollaborator(
                        ownerId,
                        documentId,
                        new CollaboratorUpsertRequest("bob@example.com", DocumentAccessLevel.NO_ACCESS)));
        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
    }

    @Test
    void updateCollaboratorAccess_withOwnerLevel_succeeds() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID bobId = UUID.randomUUID();

        User owner = User.builder().id(ownerId).build();
        User bob = User.builder().id(bobId).build();
        Document document = Document.builder().id(documentId).user(owner).build();
        DocumentCollaborator existing = DocumentCollaborator.builder()
                .document(document)
                .user(bob)
                .accessLevel(DocumentAccessLevel.EDIT)
                .build();

        when(permissionService.requireSharingAdminAccess(ownerId, documentId)).thenReturn(document);
        when(collaboratorRepository.findByDocument_IdAndUser_Id(documentId, bobId))
                .thenReturn(Optional.of(existing));
        when(userRepository.findById(bobId)).thenReturn(Optional.of(bob));
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of());

        sharingService.updateCollaboratorAccess(
                ownerId, documentId, bobId, new CollaboratorAccessUpdateRequest(DocumentAccessLevel.OWNER));

        ArgumentCaptor<DocumentCollaborator> captor = ArgumentCaptor.forClass(DocumentCollaborator.class);
        verify(collaboratorRepository).save(captor.capture());
        assertEquals(DocumentAccessLevel.OWNER, captor.getValue().getAccessLevel());
    }

    @Test
    void updateCollaboratorAccess_directOwnerCollaborator_canBeDemotedToEdit() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID bobId = UUID.randomUUID();

        User owner = User.builder().id(ownerId).build();
        User bob = User.builder().id(bobId).build();
        Document document = Document.builder().id(documentId).user(owner).build();
        DocumentCollaborator existing = DocumentCollaborator.builder()
                .document(document)
                .user(bob)
                .accessLevel(DocumentAccessLevel.OWNER)
                .build();

        when(permissionService.requireSharingAdminAccess(ownerId, documentId)).thenReturn(document);
        when(collaboratorRepository.findByDocument_IdAndUser_Id(documentId, bobId))
                .thenReturn(Optional.of(existing));
        when(userRepository.findById(bobId)).thenReturn(Optional.of(bob));
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of());

        sharingService.updateCollaboratorAccess(
                ownerId, documentId, bobId, new CollaboratorAccessUpdateRequest(DocumentAccessLevel.EDIT));

        ArgumentCaptor<DocumentCollaborator> captor = ArgumentCaptor.forClass(DocumentCollaborator.class);
        verify(collaboratorRepository).save(captor.capture());
        assertEquals(DocumentAccessLevel.EDIT, captor.getValue().getAccessLevel());
    }

    @Test
    void removeCollaborator_directOwnerCollaborator_succeeds() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID bobId = UUID.randomUUID();

        User owner = User.builder().id(ownerId).build();
        User bob = User.builder().id(bobId).build();
        Document document = Document.builder().id(documentId).user(owner).build();

        when(permissionService.requireSharingAdminAccess(ownerId, documentId)).thenReturn(document);
        when(collaboratorRepository.existsByDocument_IdAndUser_Id(documentId, bobId))
                .thenReturn(true);
        when(userRepository.findById(bobId)).thenReturn(Optional.of(bob));
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of());

        sharingService.removeCollaborator(ownerId, documentId, bobId);

        verify(collaboratorRepository).deleteByDocument_IdAndUser_Id(documentId, bobId);
        verify(userDocumentOrderRepository).deleteByUser_IdAndDocument_Id(bobId, documentId);
    }

    @Test
    void updateCollaboratorAccess_ancestorFullAccessUser_createsOverrideRow() {
        UUID actorId = UUID.randomUUID();
        UUID ancestorOwnerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID parentDocId = UUID.randomUUID();

        User ancestorOwner = User.builder().id(ancestorOwnerId).build();
        Document parent = Document.builder().id(parentDocId).user(ancestorOwner).build();
        Document child = Document.builder()
                .id(documentId)
                .user(User.builder().id(actorId).build())
                .parent(parent)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(child);
        when(collaboratorRepository.hasPositiveAncestorGrant(ancestorOwnerId, documentId))
                .thenReturn(true);
        when(collaboratorRepository.findByDocument_IdAndUser_Id(documentId, ancestorOwnerId))
                .thenReturn(Optional.empty());
        when(userRepository.findById(ancestorOwnerId)).thenReturn(Optional.of(ancestorOwner));
        when(userDocumentOrderRepository.findMinOrderKeyByUserId(ancestorOwnerId, documentId))
                .thenReturn(Optional.empty());
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of());

        sharingService.updateCollaboratorAccess(
                actorId, documentId, ancestorOwnerId, new CollaboratorAccessUpdateRequest(DocumentAccessLevel.VIEW));

        ArgumentCaptor<DocumentCollaborator> captor = ArgumentCaptor.forClass(DocumentCollaborator.class);
        verify(collaboratorRepository).save(captor.capture());
        assertEquals(DocumentAccessLevel.VIEW, captor.getValue().getAccessLevel());
    }

    @Test
    void updateCollaboratorAccess_withNoAccess_andAncestorGrant_persistsNoAccessRow() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID bobId = UUID.randomUUID();

        User owner = User.builder().id(ownerId).build();
        Document doc = Document.builder().id(documentId).user(owner).build();
        User bob = User.builder().id(bobId).build();

        when(permissionService.requireSharingAdminAccess(ownerId, documentId)).thenReturn(doc);
        when(collaboratorRepository.hasPositiveAncestorGrant(bobId, documentId)).thenReturn(true);
        when(collaboratorRepository.findByDocument_IdAndUser_Id(documentId, bobId))
                .thenReturn(Optional.empty());
        when(userRepository.findById(bobId)).thenReturn(Optional.of(bob));
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of());

        sharingService.updateCollaboratorAccess(
                ownerId, documentId, bobId, new CollaboratorAccessUpdateRequest(DocumentAccessLevel.NO_ACCESS));

        ArgumentCaptor<DocumentCollaborator> captor = ArgumentCaptor.forClass(DocumentCollaborator.class);
        verify(collaboratorRepository).save(captor.capture());
        assertEquals(DocumentAccessLevel.NO_ACCESS, captor.getValue().getAccessLevel());
        verify(userDocumentOrderRepository).deleteByUser_IdAndDocument_Id(bobId, documentId);
        verify(collaboratorRepository).pruneOrphanedBreakpoints(documentId);
    }

    @Test
    void updateCollaboratorAccess_withNoAccess_andNoAncestorGrant_deletesRowAndOrder() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID bobId = UUID.randomUUID();

        User owner = User.builder().id(ownerId).build();
        Document doc = Document.builder().id(documentId).user(owner).build();
        User bob = User.builder().id(bobId).build();
        DocumentCollaborator existing = DocumentCollaborator.builder()
                .document(doc)
                .user(bob)
                .accessLevel(DocumentAccessLevel.VIEW)
                .build();

        when(permissionService.requireSharingAdminAccess(ownerId, documentId)).thenReturn(doc);
        when(collaboratorRepository.hasPositiveAncestorGrant(bobId, documentId)).thenReturn(false);
        when(collaboratorRepository.findByDocument_IdAndUser_Id(documentId, bobId))
                .thenReturn(Optional.of(existing));
        when(userRepository.findById(bobId)).thenReturn(Optional.of(bob));
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of());

        sharingService.updateCollaboratorAccess(
                ownerId, documentId, bobId, new CollaboratorAccessUpdateRequest(DocumentAccessLevel.NO_ACCESS));

        verify(collaboratorRepository).deleteByDocument_IdAndUser_Id(documentId, bobId);
        verify(userDocumentOrderRepository).deleteByUser_IdAndDocument_Id(bobId, documentId);
        verify(collaboratorRepository).pruneOrphanedBreakpoints(documentId);
    }

    @Test
    void removeCollaborator_withInheritedOnlyUser_throwsNotFound() {
        UUID actorId = UUID.randomUUID();
        UUID ancestorOwnerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID parentDocId = UUID.randomUUID();

        User ancestorOwner = User.builder().id(ancestorOwnerId).build();
        Document parent = Document.builder().id(parentDocId).user(ancestorOwner).build();
        Document child = Document.builder()
                .id(documentId)
                .user(User.builder().id(actorId).build())
                .parent(parent)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(child);

        ApiException ex = assertThrows(
                ApiException.class, () -> sharingService.removeCollaborator(actorId, documentId, ancestorOwnerId));
        assertEquals(ErrorCode.NOT_FOUND, ex.getErrorCode());
    }

    @Test
    void removeCollaborator_directOverrideOfAncestorFullAccess_succeeds() {
        UUID actorId = UUID.randomUUID();
        UUID ancestorOwnerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID parentDocId = UUID.randomUUID();

        User ancestorOwner = User.builder().id(ancestorOwnerId).build();
        Document parent = Document.builder().id(parentDocId).user(ancestorOwner).build();
        Document child = Document.builder()
                .id(documentId)
                .user(User.builder().id(actorId).build())
                .parent(parent)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(child);
        when(collaboratorRepository.existsByDocument_IdAndUser_Id(documentId, ancestorOwnerId))
                .thenReturn(true);
        when(userRepository.findById(ancestorOwnerId)).thenReturn(Optional.of(ancestorOwner));
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of());

        sharingService.removeCollaborator(actorId, documentId, ancestorOwnerId);

        verify(collaboratorRepository).deleteByDocument_IdAndUser_Id(documentId, ancestorOwnerId);
        verify(userDocumentOrderRepository).deleteByUser_IdAndDocument_Id(ancestorOwnerId, documentId);
        verify(collaboratorRepository).pruneOrphanedBreakpoints(documentId);
    }

    @Test
    void leaveSharedDocument_prunesBreakpointsAndReconcilesOrderRows() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID ownerId = UUID.randomUUID();

        User user = User.builder().id(userId).build();
        Document document = Document.builder()
                .id(documentId)
                .user(User.builder().id(ownerId).build())
                .build();

        when(permissionService.requireReadAccessIncludingTrash(userId, documentId))
                .thenReturn(document);
        when(collaboratorRepository.existsByDocument_IdAndUser_Id(documentId, userId))
                .thenReturn(true);
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of());

        sharingService.leaveSharedDocument(userId, documentId);

        verify(collaboratorRepository).deleteByDocument_IdAndUser_Id(documentId, userId);
        verify(userDocumentOrderRepository).deleteByUser_IdAndDocument_Id(userId, documentId);
        verify(collaboratorRepository).pruneOrphanedBreakpoints(documentId);
    }

    @Test
    void listCollaborators_stopsAtTrashedAncestor() {
        UUID ownerId = UUID.randomUUID();
        UUID childDocId = UUID.randomUUID();
        UUID trashedParentId = UUID.randomUUID();
        UUID grandparentDocId = UUID.randomUUID();

        User owner = User.builder().id(ownerId).email("owner@example.com").build();
        Document grandparent = Document.builder()
                .id(grandparentDocId)
                .user(owner)
                .title("Grandparent")
                .build();
        Document trashedParent = Document.builder()
                .id(trashedParentId)
                .user(owner)
                .title("Trashed Parent")
                .parent(grandparent)
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();
        Document child = Document.builder()
                .id(childDocId)
                .user(owner)
                .parent(trashedParent)
                .title("Child")
                .build();
        when(permissionService.requireReadAccessIncludingTrash(ownerId, childDocId))
                .thenReturn(child);
        when(collaboratorRepository.findAllByDocument_Id(childDocId)).thenReturn(List.of());

        List<CollaboratorResponse> result = sharingService.listCollaborators(ownerId, childDocId);

        assertEquals(1, result.size());
        assertEquals(ownerId, result.get(0).userId());
        // The walk must stop at the trashed parent instead of surfacing live grandparent grants.
        verify(collaboratorRepository, never()).findAllByDocument_Id(grandparentDocId);
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
