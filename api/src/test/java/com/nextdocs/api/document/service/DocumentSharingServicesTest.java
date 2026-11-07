package com.nextdocs.api.document.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.nextdocs.api.audit.entity.AccessAuditAction;
import com.nextdocs.api.audit.service.AccessAuditService;
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
import com.nextdocs.api.document.entity.AccessGrant;
import com.nextdocs.api.document.entity.AccessGrantEffect;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.entity.DocumentGeneralAccessMode;
import com.nextdocs.api.document.entity.DocumentWorkspaceAccessMode;
import com.nextdocs.api.document.entity.UserDocumentOrder;
import com.nextdocs.api.document.repository.AccessGrantRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.repository.UserDocumentOrderRepository;
import com.nextdocs.api.space.entity.Space;
import com.nextdocs.api.space.entity.SpaceAccessMode;
import com.nextdocs.api.space.entity.SpaceMember;
import com.nextdocs.api.space.repository.SpaceMemberRepository;
import com.nextdocs.api.space.service.SpaceAccessService;
import com.nextdocs.api.space.service.SpaceAccessService.SpaceContext;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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
class DocumentSharingServicesTest {

    @Mock
    private DocumentRepository documentRepository;

    @Mock
    private AccessGrantRepository accessGrantRepository;

    @Mock
    private UserDocumentOrderRepository userDocumentOrderRepository;

    @Mock
    private UserRepository userRepository;

    @Mock
    private PermissionService permissionService;

    @Mock
    private SpaceAccessService spaceAccessService;

    @Mock
    private SpaceMemberRepository spaceMemberRepository;

    @Mock
    private AccessGrantSyncService accessGrantSyncService;

    @Mock
    private AccessAuditService auditService;

    private DocumentSharingService sharingService;
    private DocumentSharingSettingsService settingsService;

    @BeforeEach
    void setUp() {
        sharingService = new DocumentSharingService(
                documentRepository,
                accessGrantRepository,
                userDocumentOrderRepository,
                userRepository,
                permissionService,
                spaceAccessService,
                spaceMemberRepository,
                accessGrantSyncService,
                auditService,
                event -> {});
        settingsService =
                new DocumentSharingSettingsService(documentRepository, permissionService, auditService, event -> {});

        org.mockito.Mockito.lenient()
                .when(accessGrantSyncService.upsertUserGrant(any(), any(), any(), any()))
                .thenAnswer(invocation -> {
                    Document document = invocation.getArgument(0);
                    User user = invocation.getArgument(1);
                    DocumentAccessLevel level = invocation.getArgument(2);
                    return AccessGrant.builder()
                            .id(UUID.randomUUID())
                            .document(document)
                            .user(user)
                            .effect(
                                    level == DocumentAccessLevel.NO_ACCESS
                                            ? AccessGrantEffect.DENY
                                            : AccessGrantEffect.ALLOW)
                            .accessLevel(level == DocumentAccessLevel.NO_ACCESS ? null : level)
                            .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                            .build();
                });
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
    void accessCheck_ownerOfAnArchivedSpacePage_getsViewNotOwner() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = Document.builder()
                .id(documentId)
                .user(User.builder().id(ownerId).build())
                .space(Space.builder()
                        .id(UUID.randomUUID())
                        .name("Archived")
                        .archivedAt(OffsetDateTime.now(ZoneOffset.UTC))
                        .build())
                .build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(document));
        when(permissionService.resolveAccess(ownerId, documentId)).thenReturn(DocumentAccessLevel.VIEW);

        DocumentAccessResponse response = sharingService.accessCheck(ownerId, documentId);

        assertTrue(response.allowed());
        assertEquals(DocumentAccessLevel.VIEW, response.accessLevel());
        assertTrue(response.owner());
    }

    @Test
    void leaveSharedDocument_inAnArchivedSpace_isBlocked() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = Document.builder()
                .id(documentId)
                .user(User.builder().id(UUID.randomUUID()).build())
                .space(Space.builder()
                        .id(UUID.randomUUID())
                        .name("Archived")
                        .archivedAt(OffsetDateTime.now(ZoneOffset.UTC))
                        .build())
                .build();

        when(permissionService.requireReadAccessIncludingTrash(userId, documentId))
                .thenReturn(document);
        doThrow(new ApiException(ErrorCode.CONFLICT)).when(permissionService).requireActiveSpace(document);

        ApiException ex =
                assertThrows(ApiException.class, () -> sharingService.leaveSharedDocument(userId, documentId));
        assertEquals(ErrorCode.CONFLICT, ex.getErrorCode());
        verify(accessGrantRepository, never()).deleteByDocument_IdAndUser_Id(any(), any());
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
        when(accessGrantRepository.existsByDocument_IdAndUser_Id(documentId, collaboratorUserId))
                .thenReturn(true);

        sharingService.removeCollaborator(ownerId, documentId, collaboratorUserId);

        verify(accessGrantRepository).deleteByDocument_IdAndUser_Id(documentId, collaboratorUserId);
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
        when(accessGrantRepository.findUserGrantsByDocumentId(documentId)).thenReturn(List.of());

        List<CollaboratorResponse> result = sharingService.listCollaborators(ownerId, documentId);

        assertEquals(1, result.size());
        assertEquals(DocumentAccessLevel.OWNER, result.get(0).accessLevel());
    }

    @Test
    void listCollaborators_linkOnlyReader_cannotEnumerateRoster() {
        UUID ownerId = UUID.randomUUID();
        UUID linkOnlyId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document doc = Document.builder()
                .id(documentId)
                .user(User.builder()
                        .id(ownerId)
                        .email("owner@example.com")
                        .displayName("Owner")
                        .build())
                .build();

        when(permissionService.requireReadAccessIncludingTrash(linkOnlyId, documentId))
                .thenReturn(doc);
        when(accessGrantRepository.hasPositiveIdentityGrant(linkOnlyId, documentId))
                .thenReturn(false);

        assertThrows(ApiException.class, () -> sharingService.listCollaborators(linkOnlyId, documentId));
    }

    @Test
    void listCollaborators_inheritedGrantAndPageDenyWithLiveLinkKeepsBroadestAccessRoster() {
        UUID ownerId = UUID.randomUUID();
        UUID memberId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document doc = Document.builder()
                .id(documentId)
                .user(User.builder()
                        .id(ownerId)
                        .email("owner@example.com")
                        .displayName("Owner")
                        .build())
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.VIEW)
                .build();

        when(permissionService.requireReadAccessIncludingTrash(memberId, documentId))
                .thenReturn(doc);
        // The SQL regression test covers ancestor ALLOW + page DENY. The gate receives
        // its positive identity result while the independent live link grants page read.
        when(accessGrantRepository.hasPositiveIdentityGrant(memberId, documentId))
                .thenReturn(true);

        User memberUser = User.builder()
                .id(memberId)
                .email("member@example.com")
                .displayName("Member")
                .build();
        AccessGrant pageDeny = AccessGrant.builder()
                .user(memberUser)
                .effect(AccessGrantEffect.DENY)
                .build();

        when(accessGrantRepository.findUserGrantsByDocumentId(documentId)).thenReturn(List.of(pageDeny));
        when(documentRepository.findAncestorChainIds(documentId)).thenReturn(List.of());
        when(permissionService.resolveAccessForUsers(documentId, List.of(ownerId, memberId), false))
                .thenReturn(Map.of(ownerId, DocumentAccessLevel.OWNER, memberId, DocumentAccessLevel.VIEW));

        List<CollaboratorResponse> roster = sharingService.listCollaborators(memberId, documentId);

        assertEquals(2, roster.size());
        assertEquals(ownerId, roster.get(0).userId());
        assertEquals(memberId, roster.get(1).userId());
        assertEquals(DocumentAccessLevel.NO_ACCESS, roster.get(1).accessLevel());
        assertEquals(DocumentAccessLevel.VIEW, roster.get(1).effectiveAccessLevel());
    }

    @Test
    void listCollaborators_workspaceAudienceReaderPassesIdentityRosterGate() {
        UUID ownerId = UUID.randomUUID();
        UUID memberId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document doc = Document.builder()
                .id(documentId)
                .user(User.builder().id(ownerId).build())
                .workspaceAccessMode(DocumentWorkspaceAccessMode.WORKSPACE_MEMBERS)
                .workspaceAccessLevel(DocumentAccessLevel.VIEW)
                .build();

        when(permissionService.requireReadAccessIncludingTrash(memberId, documentId))
                .thenReturn(doc);
        when(accessGrantRepository.hasPositiveIdentityGrant(memberId, documentId))
                .thenReturn(true);
        when(accessGrantRepository.findUserGrantsByDocumentId(documentId)).thenReturn(List.of());
        when(documentRepository.findAncestorChainIds(documentId)).thenReturn(List.of());
        when(permissionService.resolveAccessForUsers(documentId, List.of(ownerId), false))
                .thenReturn(Map.of());

        List<CollaboratorResponse> roster = sharingService.listCollaborators(memberId, documentId);

        assertEquals(1, roster.size());
        assertEquals(ownerId, roster.get(0).userId());
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
        when(userDocumentOrderRepository.existsByUser_IdAndDocument_Id(targetUser.getId(), documentId))
                .thenReturn(false);
        when(userDocumentOrderRepository.findMinOrderKeyByUserId(targetUser.getId(), documentId))
                .thenReturn(Optional.of("a5"));

        CollaboratorResponse response = sharingService.upsertCollaborator(
                ownerId, documentId, new CollaboratorUpsertRequest("alice@example.com", DocumentAccessLevel.EDIT));

        ArgumentCaptor<UserDocumentOrder> orderCaptor = ArgumentCaptor.forClass(UserDocumentOrder.class);
        verify(userDocumentOrderRepository).saveAndFlush(orderCaptor.capture());
        assertTrue(orderCaptor.getValue().getOrderKey().compareTo("a5") < 0);

        assertEquals(targetUser.getId(), response.userId());
        assertNotNull(response.addedAt());
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
        when(userDocumentOrderRepository.existsByUser_IdAndDocument_Id(targetUser.getId(), documentId))
                .thenReturn(false);
        when(userDocumentOrderRepository.findMinOrderKeyByUserId(targetUser.getId(), documentId))
                .thenReturn(Optional.of("a5"));

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
        when(accessGrantRepository.existsByDocument_IdAndUser_Id(documentId, collaboratorId))
                .thenReturn(true);

        sharingService.removeCollaborator(ownerId, documentId, collaboratorId);

        verify(accessGrantRepository).deleteByDocument_IdAndUser_Id(documentId, collaboratorId);
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
        when(userDocumentOrderRepository.existsByUser_IdAndDocument_Id(targetUser.getId(), documentId))
                .thenReturn(false);
        when(userDocumentOrderRepository.findMinOrderKeyByUserId(targetUser.getId(), documentId))
                .thenReturn(Optional.of("a5"));

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
        when(userDocumentOrderRepository.existsByUser_IdAndDocument_Id(targetUser.getId(), documentId))
                .thenReturn(true);

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
        when(userRepository.findById(actorId)).thenReturn(Optional.of(actor));
        when(userDocumentOrderRepository.existsByUser_IdAndDocument_Id(targetUser.getId(), documentId))
                .thenReturn(true);

        CollaboratorResponse response = sharingService.upsertCollaborator(
                actorId, documentId, new CollaboratorUpsertRequest("newbie@example.com", DocumentAccessLevel.VIEW));

        verify(accessGrantSyncService).upsertUserGrant(document, targetUser, DocumentAccessLevel.VIEW, actor);
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
        when(userDocumentOrderRepository.findMinOrderKeyByUserId(ancestorOwner.getId(), documentId))
                .thenReturn(Optional.empty());

        sharingService.upsertCollaborator(
                actorId, documentId, new CollaboratorUpsertRequest("ancestor@example.com", DocumentAccessLevel.VIEW));

        verify(accessGrantSyncService).upsertUserGrant(any(), any(), eq(DocumentAccessLevel.VIEW), any());
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
        AccessGrant collaborator = AccessGrant.builder()
                .id(UUID.randomUUID())
                .document(doc)
                .user(collabUser)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.OWNER)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(permissionService.requireReadAccessIncludingTrash(ownerId, documentId))
                .thenReturn(doc);
        when(accessGrantRepository.findUserGrantsByDocumentId(documentId)).thenReturn(List.of(collaborator));

        List<CollaboratorResponse> result = sharingService.listCollaborators(ownerId, documentId);

        assertEquals(2, result.size());
        assertTrue(result.get(0).owner());
        assertEquals(ownerId, result.get(0).userId());
        assertFalse(result.get(1).owner());
        assertEquals(collabOwnerRoleId, result.get(1).userId());
        assertEquals(DocumentAccessLevel.OWNER, result.get(1).accessLevel());
    }

    @Test
    void listCollaborators_reportsEffectiveLevelForDemotedOwnerAndBlockedRow() {
        UUID ownerId = UUID.randomUUID();
        UUID demotedOwnerId = UUID.randomUUID();
        UUID blockedId = UUID.randomUUID();
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

        AccessGrant demotedOwner = AccessGrant.builder()
                .id(UUID.randomUUID())
                .document(doc)
                .user(User.builder()
                        .id(demotedOwnerId)
                        .email("demoted@example.com")
                        .displayName("Demoted Owner")
                        .build())
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.OWNER)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();
        AccessGrant blocked = AccessGrant.builder()
                .id(UUID.randomUUID())
                .document(doc)
                .user(User.builder()
                        .id(blockedId)
                        .email("blocked@example.com")
                        .displayName("Blocked")
                        .build())
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.EDIT)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(permissionService.requireReadAccessIncludingTrash(ownerId, documentId))
                .thenReturn(doc);
        when(accessGrantRepository.findUserGrantsByDocumentId(documentId)).thenReturn(List.of(demotedOwner, blocked));
        Map<UUID, DocumentAccessLevel> effective = new HashMap<>();
        effective.put(ownerId, DocumentAccessLevel.OWNER);
        effective.put(demotedOwnerId, DocumentAccessLevel.VIEW);
        effective.put(blockedId, null);
        when(permissionService.resolveAccessForUsers(documentId, List.of(ownerId, demotedOwnerId, blockedId), false))
                .thenReturn(effective);

        List<CollaboratorResponse> result = sharingService.listCollaborators(ownerId, documentId);

        assertEquals(3, result.size());
        assertEquals(DocumentAccessLevel.OWNER, result.get(0).effectiveAccessLevel());
        // The stored grant stays OWNER (that is what the row edits), while the
        // space caps what the person can actually do.
        assertEquals(DocumentAccessLevel.OWNER, result.get(1).accessLevel());
        assertEquals(DocumentAccessLevel.VIEW, result.get(1).effectiveAccessLevel());
        // A missing map entry means blocked, not "not queried".
        assertEquals(DocumentAccessLevel.NO_ACCESS, result.get(2).effectiveAccessLevel());
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

        SharingSettingsResponse getResponse = settingsService.getSharingSettings(actorId, documentId);
        assertEquals(DocumentGeneralAccessMode.RESTRICTED, getResponse.generalAccessMode());
        assertFalse(getResponse.hasActiveLink());

        when(documentRepository.save(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));

        SharingSettingsResponse updateResponse = settingsService.updateSharingSettings(
                actorId,
                documentId,
                new SharingSettingsUpdateRequest(
                        DocumentGeneralAccessMode.ANYONE_WITH_LINK, DocumentAccessLevel.EDIT, null));

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
        AccessGrant directCollab = AccessGrant.builder()
                .id(UUID.randomUUID())
                .document(child)
                .user(directCollabUser)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.EDIT)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        UUID parentCollabUserId = UUID.randomUUID();
        User parentCollabUser = User.builder()
                .id(parentCollabUserId)
                .email("parentcollab@example.com")
                .displayName("Parent Collab")
                .build();
        AccessGrant parentCollab = AccessGrant.builder()
                .id(UUID.randomUUID())
                .document(parent)
                .user(parentCollabUser)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.VIEW)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(permissionService.requireReadAccessIncludingTrash(ownerId, childDocId))
                .thenReturn(child);
        when(accessGrantRepository.findUserGrantsByDocumentId(childDocId)).thenReturn(List.of(directCollab));
        stubAncestorChain(child, List.of(parent), List.of(parentCollab));

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
        stubAncestorChain(child, List.of(parent), List.of());

        SharingSettingsResponse response = settingsService.getSharingSettings(actorId, childDocId);

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
        stubAncestorChain(child, List.of(parent), List.of());

        SharingSettingsResponse response = settingsService.getSharingSettings(actorId, childDocId);

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
        // The chain reports the trashed parent and the live grandparent, but resolution
        // stops at the trash boundary so the grandparent's link grant never applies.
        when(documentRepository.findAncestorChainIds(childDocId))
                .thenReturn(List.of(trashedParentDocId, grandparentDocId));
        when(documentRepository.findAllWithUserByIdIn(List.of(trashedParentDocId, grandparentDocId)))
                .thenReturn(List.of(trashedParent, grandparent));

        SharingSettingsResponse response = settingsService.getSharingSettings(actorId, childDocId);

        assertFalse(response.inherited());
        assertNull(response.inheritedFromId());
        assertNull(response.inheritedFromTitle());
        assertEquals(DocumentAccessLevel.COMMENT, response.linkAccessLevel());
    }

    @Test
    void getSharingSettings_withOwnLinkOverAncestorPublicLink_returnsOverrideProvenance() {
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
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.EDIT)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, childDocId)).thenReturn(child);
        stubAncestorChain(child, List.of(parent), List.of());

        SharingSettingsResponse response = settingsService.getSharingSettings(actorId, childDocId);

        assertTrue(response.hasActiveLink());
        assertFalse(response.inherited());
        assertEquals(parentDocId, response.inheritedFromId());
        assertEquals("Parent Wiki", response.inheritedFromTitle());
        // The child's own level wins (closest-ancestor-wins), not the ancestor's.
        assertEquals(DocumentAccessLevel.EDIT, response.linkAccessLevel());
    }

    @Test
    void accessCheckPublic_inheritedLink_returnsAncestorLevel() {
        UUID documentId = UUID.randomUUID();
        Document document = createSharedDocument(documentId, DocumentAccessLevel.VIEW);
        document.setGeneralAccessMode(DocumentGeneralAccessMode.RESTRICTED);

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(document));
        when(permissionService.resolvePublicAccess(documentId)).thenReturn(DocumentAccessLevel.EDIT);

        DocumentAccessResponse response = sharingService.accessCheckPublic(documentId);

        assertTrue(response.allowed());
        assertEquals(DocumentAccessLevel.EDIT, response.accessLevel());
        assertFalse(response.owner());
    }

    @Test
    void accessCheckPublic_privateDoc_deniesAccess() {
        UUID documentId = UUID.randomUUID();
        Document document = createSharedDocument(documentId, DocumentAccessLevel.VIEW);
        document.setGeneralAccessMode(DocumentGeneralAccessMode.RESTRICTED);

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(document));
        when(permissionService.resolvePublicAccess(documentId)).thenReturn(null);

        DocumentAccessResponse response = sharingService.accessCheckPublic(documentId);

        assertFalse(response.allowed());
        assertNull(response.accessLevel());
    }

    @Test
    void accessCheckPublic_trashedDoc_deniesAccess() {
        UUID documentId = UUID.randomUUID();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.empty());

        DocumentAccessResponse response = sharingService.accessCheckPublic(documentId);

        assertFalse(response.allowed());
        assertFalse(response.trashed());
    }

    @Test
    void updateSharingSettings_underBlockedParent_normalizesRedundantBlockAway() {
        UUID actorId = UUID.randomUUID();
        UUID childDocId = UUID.randomUUID();
        UUID parentDocId = UUID.randomUUID();
        UUID grandparentDocId = UUID.randomUUID();

        User owner = User.builder().id(actorId).build();

        Document grandparent = Document.builder()
                .id(grandparentDocId)
                .user(owner)
                .title("Grandparent Wiki")
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.EDIT)
                .build();

        Document parent = Document.builder()
                .id(parentDocId)
                .user(owner)
                .parent(grandparent)
                .title("Blocked Parent")
                .generalAccessMode(DocumentGeneralAccessMode.RESTRICTED)
                .linkInheritBlocked(true)
                .build();

        Document child = Document.builder()
                .id(childDocId)
                .user(owner)
                .parent(parent)
                .title("Child Doc")
                .generalAccessMode(DocumentGeneralAccessMode.RESTRICTED)
                .linkInheritBlocked(false)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, childDocId)).thenReturn(child);

        SharingSettingsUpdateRequest request =
                new SharingSettingsUpdateRequest(DocumentGeneralAccessMode.RESTRICTED, null, true);
        stubAncestorChain(child, List.of(parent, grandparent), List.of());

        SharingSettingsResponse response = settingsService.updateSharingSettings(actorId, childDocId, request);

        // Child must normalize linkInheritBlocked away to false because parent is already blocked
        assertFalse(child.isLinkInheritBlocked());
        assertFalse(response.linkInheritBlocked());
        assertNull(response.inheritedFromId());
    }

    @Test
    void getSharingSettings_withOwnBlock_returnsBlockedWithShadowedGrant() {
        UUID actorId = UUID.randomUUID();
        UUID childDocId = UUID.randomUUID();
        UUID parentDocId = UUID.randomUUID();

        User owner = User.builder().id(actorId).build();

        Document parent = Document.builder()
                .id(parentDocId)
                .user(owner)
                .title("Parent Wiki")
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.EDIT)
                .build();

        Document child = Document.builder()
                .id(childDocId)
                .user(owner)
                .parent(parent)
                .generalAccessMode(DocumentGeneralAccessMode.RESTRICTED)
                .linkInheritBlocked(true)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, childDocId)).thenReturn(child);
        stubAncestorChain(child, List.of(parent), List.of());

        SharingSettingsResponse response = settingsService.getSharingSettings(actorId, childDocId);

        assertTrue(response.linkInheritBlocked());
        assertFalse(response.inherited());
        assertFalse(response.hasActiveLink());
        // Shadowed grant is surfaced for the "Inherit from X" affordance only;
        // the effective link level stays the child's own (private).
        assertEquals(parentDocId, response.inheritedFromId());
        assertEquals("Parent Wiki", response.inheritedFromTitle());
    }

    @Test
    void getSharingSettings_withBlockedAncestor_doesNotInherit() {
        UUID actorId = UUID.randomUUID();
        UUID childDocId = UUID.randomUUID();
        UUID blockedParentDocId = UUID.randomUUID();
        UUID grandparentDocId = UUID.randomUUID();

        User owner = User.builder().id(actorId).build();

        Document grandparent = Document.builder()
                .id(grandparentDocId)
                .user(owner)
                .title("Grandparent Wiki")
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.EDIT)
                .build();

        Document blockedParent = Document.builder()
                .id(blockedParentDocId)
                .user(owner)
                .title("Blocked Parent")
                .parent(grandparent)
                .generalAccessMode(DocumentGeneralAccessMode.RESTRICTED)
                .linkInheritBlocked(true)
                .build();

        Document child = Document.builder()
                .id(childDocId)
                .user(owner)
                .parent(blockedParent)
                .generalAccessMode(DocumentGeneralAccessMode.RESTRICTED)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, childDocId)).thenReturn(child);
        stubAncestorChain(child, List.of(blockedParent, grandparent), List.of());

        SharingSettingsResponse response = settingsService.getSharingSettings(actorId, childDocId);

        assertFalse(response.linkInheritBlocked());
        assertFalse(response.inherited());
        assertNull(response.inheritedFromId());
        assertNull(response.inheritedFromTitle());
    }

    @Test
    void updateSharingSettings_canBlockAndUnblockInheritance() {
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
        when(documentRepository.save(child)).thenReturn(child);
        stubAncestorChain(child, List.of(parent), List.of());

        SharingSettingsResponse blocked = settingsService.updateSharingSettings(
                actorId,
                childDocId,
                new SharingSettingsUpdateRequest(DocumentGeneralAccessMode.RESTRICTED, null, true));

        assertTrue(blocked.linkInheritBlocked());
        assertFalse(blocked.inherited());

        SharingSettingsResponse reinherited = settingsService.updateSharingSettings(
                actorId,
                childDocId,
                new SharingSettingsUpdateRequest(DocumentGeneralAccessMode.RESTRICTED, null, false));

        assertFalse(reinherited.linkInheritBlocked());
        assertTrue(reinherited.inherited());
        assertEquals(parentDocId, reinherited.inheritedFromId());
    }

    @Test
    void updateSharingSettings_ownLinkAutoClearsBlock() {
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        User owner = User.builder().id(actorId).build();

        Document doc = Document.builder()
                .id(documentId)
                .user(owner)
                .generalAccessMode(DocumentGeneralAccessMode.RESTRICTED)
                .linkInheritBlocked(true)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(doc);
        when(documentRepository.save(doc)).thenReturn(doc);

        SharingSettingsResponse response = settingsService.updateSharingSettings(
                actorId,
                documentId,
                new SharingSettingsUpdateRequest(
                        DocumentGeneralAccessMode.ANYONE_WITH_LINK, DocumentAccessLevel.EDIT, null));

        assertTrue(response.hasActiveLink());
        assertFalse(response.linkInheritBlocked());
        assertEquals(DocumentAccessLevel.EDIT, response.linkAccessLevel());
        verify(auditService)
                .recordDocument(
                        eq(doc),
                        eq(actorId),
                        eq(AccessAuditAction.SHARING_SETTINGS_UPDATE),
                        isNull(),
                        isNull(),
                        anyString());
    }

    @Test
    void updateSharingSettings_omittedExpiryPreservesItAndClearFlagRemovesIt() {
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        OffsetDateTime expiry = OffsetDateTime.now(ZoneOffset.UTC).plusDays(7);
        User owner = User.builder().id(actorId).build();
        Document doc = Document.builder()
                .id(documentId)
                .user(owner)
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.VIEW)
                .linkExpiresAt(expiry)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(doc);
        when(documentRepository.save(doc)).thenReturn(doc);

        settingsService.updateSharingSettings(
                actorId,
                documentId,
                new SharingSettingsUpdateRequest(
                        DocumentGeneralAccessMode.ANYONE_WITH_LINK, DocumentAccessLevel.EDIT, null));

        assertEquals(expiry, doc.getLinkExpiresAt());

        settingsService.updateSharingSettings(
                actorId,
                documentId,
                new SharingSettingsUpdateRequest(
                        DocumentGeneralAccessMode.ANYONE_WITH_LINK,
                        DocumentAccessLevel.EDIT,
                        null,
                        null,
                        null,
                        null,
                        null,
                        true));

        assertNull(doc.getLinkExpiresAt());
    }

    @Test
    void updateSharingSettings_workspacePatchPreservesLinkModeLevelAndExpiry() {
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        OffsetDateTime expiry = OffsetDateTime.now(ZoneOffset.UTC).plusDays(7);
        User owner = User.builder().id(actorId).build();
        Document doc = Document.builder()
                .id(documentId)
                .user(owner)
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.EDIT)
                .linkExpiresAt(expiry)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(doc);
        when(documentRepository.save(doc)).thenReturn(doc);

        settingsService.updateSharingSettings(
                actorId,
                documentId,
                new SharingSettingsUpdateRequest(
                        null,
                        null,
                        null,
                        DocumentWorkspaceAccessMode.WORKSPACE_MEMBERS,
                        DocumentAccessLevel.VIEW,
                        null,
                        null,
                        null));

        assertEquals(DocumentGeneralAccessMode.ANYONE_WITH_LINK, doc.getGeneralAccessMode());
        assertEquals(DocumentAccessLevel.EDIT, doc.getLinkAccessLevel());
        assertEquals(expiry, doc.getLinkExpiresAt());
        assertEquals(DocumentWorkspaceAccessMode.WORKSPACE_MEMBERS, doc.getWorkspaceAccessMode());
        assertEquals(DocumentAccessLevel.VIEW, doc.getWorkspaceAccessLevel());
    }

    @Test
    void updateSharingSettings_workspaceLevelAndBlockPatchAppliesBothFields() {
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        User owner = User.builder().id(actorId).build();
        Document doc = Document.builder()
                .id(documentId)
                .user(owner)
                .workspaceAccessMode(DocumentWorkspaceAccessMode.WORKSPACE_MEMBERS)
                .workspaceAccessLevel(DocumentAccessLevel.VIEW)
                .workspaceInheritBlocked(true)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(doc);
        when(documentRepository.save(doc)).thenReturn(doc);

        settingsService.updateSharingSettings(
                actorId,
                documentId,
                new SharingSettingsUpdateRequest(null, null, null, null, DocumentAccessLevel.EDIT, false, null, null));

        assertEquals(DocumentAccessLevel.EDIT, doc.getWorkspaceAccessLevel());
        assertFalse(doc.isWorkspaceInheritBlocked());
    }

    @Test
    void updateSharingSettings_blockWithoutLiveAncestorGrant_isNormalizedAway() {
        UUID actorId = UUID.randomUUID();
        UUID childDocId = UUID.randomUUID();
        UUID parentDocId = UUID.randomUUID();

        User owner = User.builder().id(actorId).build();

        Document parent = Document.builder()
                .id(parentDocId)
                .user(owner)
                .title("Private Parent")
                .generalAccessMode(DocumentGeneralAccessMode.RESTRICTED)
                .build();

        Document child = Document.builder()
                .id(childDocId)
                .user(owner)
                .parent(parent)
                .generalAccessMode(DocumentGeneralAccessMode.RESTRICTED)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, childDocId)).thenReturn(child);
        when(documentRepository.save(child)).thenReturn(child);

        SharingSettingsResponse response = settingsService.updateSharingSettings(
                actorId,
                childDocId,
                new SharingSettingsUpdateRequest(DocumentGeneralAccessMode.RESTRICTED, null, true));

        // No ancestor link exists, so the block would deny nothing (mirrors a
        // NO_ACCESS row with no ancestor grant being deleted, not stored).
        assertFalse(response.linkInheritBlocked());
        assertFalse(response.inherited());
        assertNull(response.inheritedFromId());
    }

    @Test
    void getSharingSettings_withAncestorWorkspaceAccess_returnsInheritedWorkspaceSettings() {
        UUID actorId = UUID.randomUUID();
        UUID childDocId = UUID.randomUUID();
        UUID parentDocId = UUID.randomUUID();

        User owner = User.builder().id(actorId).build();
        Document parent = Document.builder()
                .id(parentDocId)
                .user(owner)
                .title("Parent Wiki")
                .workspaceAccessMode(DocumentWorkspaceAccessMode.WORKSPACE_MEMBERS)
                .workspaceAccessLevel(DocumentAccessLevel.EDIT)
                .build();
        Document child = Document.builder()
                .id(childDocId)
                .user(owner)
                .parent(parent)
                .workspaceAccessMode(DocumentWorkspaceAccessMode.RESTRICTED)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, childDocId)).thenReturn(child);
        stubAncestorChain(child, List.of(parent), List.of());

        SharingSettingsResponse response = settingsService.getSharingSettings(actorId, childDocId);

        assertTrue(response.workspaceInherited());
        assertEquals(DocumentAccessLevel.EDIT, response.workspaceAccessLevel());
        assertEquals(parentDocId, response.workspaceInheritedFromId());
        assertEquals("Parent Wiki", response.workspaceInheritedFromTitle());
        assertFalse(response.workspaceInheritBlocked());
    }

    @Test
    void updateSharingSettings_enablesWorkspaceAccessAndClearsBlock() {
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        Document doc = Document.builder()
                .id(documentId)
                .user(User.builder().id(actorId).build())
                .generalAccessMode(DocumentGeneralAccessMode.RESTRICTED)
                .workspaceAccessMode(DocumentWorkspaceAccessMode.RESTRICTED)
                .workspaceInheritBlocked(true)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(doc);
        when(documentRepository.save(doc)).thenReturn(doc);

        SharingSettingsResponse response = settingsService.updateSharingSettings(
                actorId,
                documentId,
                new SharingSettingsUpdateRequest(
                        DocumentGeneralAccessMode.RESTRICTED,
                        null,
                        null,
                        DocumentWorkspaceAccessMode.WORKSPACE_MEMBERS,
                        DocumentAccessLevel.COMMENT,
                        null,
                        null));

        assertEquals(DocumentWorkspaceAccessMode.WORKSPACE_MEMBERS, response.workspaceAccessMode());
        assertEquals(DocumentAccessLevel.COMMENT, response.workspaceAccessLevel());
        assertFalse(response.workspaceInheritBlocked());
        assertFalse(doc.isWorkspaceInheritBlocked());
    }

    @Test
    void getSharingSettings_withExpiredOwnLink_ignoresItAndInheritsAncestor() {
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
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.EDIT)
                .linkExpiresAt(OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(1))
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, childDocId)).thenReturn(child);
        stubAncestorChain(child, List.of(parent), List.of());

        SharingSettingsResponse response = settingsService.getSharingSettings(actorId, childDocId);

        assertFalse(response.hasActiveLink());
        assertTrue(response.inherited());
        assertEquals(parentDocId, response.inheritedFromId());
        assertEquals(DocumentAccessLevel.VIEW, response.linkAccessLevel());
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

        AccessGrant directCollab = AccessGrant.builder()
                .id(UUID.randomUUID())
                .document(child)
                .user(bob)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.VIEW)
                .build();

        AccessGrant parentCollab = AccessGrant.builder()
                .id(UUID.randomUUID())
                .document(parent)
                .user(bob)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.EDIT)
                .build();

        when(permissionService.requireReadAccessIncludingTrash(ownerId, childDocId))
                .thenReturn(child);
        when(accessGrantRepository.findUserGrantsByDocumentId(childDocId)).thenReturn(List.of(directCollab));
        stubAncestorChain(child, List.of(parent), List.of(parentCollab));

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

        AccessGrant parentNoAccess = AccessGrant.builder()
                .id(UUID.randomUUID())
                .document(parent)
                .user(bob)
                .effect(AccessGrantEffect.DENY)
                .build();

        AccessGrant grandparentEdit = AccessGrant.builder()
                .id(UUID.randomUUID())
                .document(grandparent)
                .user(bob)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.EDIT)
                .build();

        when(permissionService.requireReadAccessIncludingTrash(ownerId, childDocId))
                .thenReturn(child);
        when(accessGrantRepository.findUserGrantsByDocumentId(childDocId)).thenReturn(List.of());
        stubAncestorChain(child, List.of(parent, grandparent), List.of(parentNoAccess, grandparentEdit));

        List<CollaboratorResponse> result = sharingService.listCollaborators(ownerId, childDocId);

        assertEquals(1, result.size());
        assertEquals(ownerId, result.get(0).userId());
    }

    @Test
    void listCollaborators_withDirectOverrideBehindNoAccess_attributesNoAncestorSource() {
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

        AccessGrant directView = AccessGrant.builder()
                .id(UUID.randomUUID())
                .document(child)
                .user(bob)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.VIEW)
                .build();

        AccessGrant parentNoAccess = AccessGrant.builder()
                .id(UUID.randomUUID())
                .document(parent)
                .user(bob)
                .effect(AccessGrantEffect.DENY)
                .build();

        AccessGrant grandparentEdit = AccessGrant.builder()
                .id(UUID.randomUUID())
                .document(grandparent)
                .user(bob)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.EDIT)
                .build();

        when(permissionService.requireReadAccessIncludingTrash(ownerId, childDocId))
                .thenReturn(child);
        when(accessGrantRepository.findUserGrantsByDocumentId(childDocId)).thenReturn(List.of(directView));
        stubAncestorChain(child, List.of(parent, grandparent), List.of(parentNoAccess, grandparentEdit));

        List<CollaboratorResponse> result = sharingService.listCollaborators(ownerId, childDocId);

        assertEquals(2, result.size());
        CollaboratorResponse bobResp = result.get(1);
        assertEquals(bobId, bobResp.userId());
        assertEquals(DocumentAccessLevel.VIEW, bobResp.accessLevel());
        assertFalse(bobResp.inherited());
        // Removing the direct row would still leave Bob blocked by the parent
        // breakpoint, so the grandparent grant must not be offered as an
        // "Inherit" target.
        assertNull(bobResp.inheritedFromId());
        assertNull(bobResp.inheritedFromTitle());
        assertNull(bobResp.inheritedAccessLevel());
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
        AccessGrant existing = AccessGrant.builder()
                .document(document)
                .user(bob)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.EDIT)
                .build();

        when(permissionService.requireSharingAdminAccess(ownerId, documentId)).thenReturn(document);
        when(accessGrantRepository.findByDocument_IdAndUser_Id(documentId, bobId))
                .thenReturn(Optional.of(existing));
        when(userRepository.findById(bobId)).thenReturn(Optional.of(bob));
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of());

        sharingService.updateCollaboratorAccess(
                ownerId, documentId, bobId, new CollaboratorAccessUpdateRequest(DocumentAccessLevel.OWNER));

        verify(accessGrantSyncService).upsertUserGrant(any(), any(), eq(DocumentAccessLevel.OWNER), any());
    }

    @Test
    void updateCollaboratorAccess_directOwnerCollaborator_canBeDemotedToEdit() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID bobId = UUID.randomUUID();

        User owner = User.builder().id(ownerId).build();
        User bob = User.builder().id(bobId).build();
        Document document = Document.builder().id(documentId).user(owner).build();
        AccessGrant existing = AccessGrant.builder()
                .document(document)
                .user(bob)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.OWNER)
                .build();

        when(permissionService.requireSharingAdminAccess(ownerId, documentId)).thenReturn(document);
        when(accessGrantRepository.findByDocument_IdAndUser_Id(documentId, bobId))
                .thenReturn(Optional.of(existing));
        when(userRepository.findById(bobId)).thenReturn(Optional.of(bob));
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of());

        sharingService.updateCollaboratorAccess(
                ownerId, documentId, bobId, new CollaboratorAccessUpdateRequest(DocumentAccessLevel.EDIT));

        verify(accessGrantSyncService).upsertUserGrant(any(), any(), eq(DocumentAccessLevel.EDIT), any());
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
        when(accessGrantRepository.existsByDocument_IdAndUser_Id(documentId, bobId))
                .thenReturn(true);
        when(userRepository.findById(bobId)).thenReturn(Optional.of(bob));
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of());

        sharingService.removeCollaborator(ownerId, documentId, bobId);

        verify(accessGrantRepository).deleteByDocument_IdAndUser_Id(documentId, bobId);
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
        when(accessGrantRepository.hasPositiveIdentityGrant(ancestorOwnerId, documentId))
                .thenReturn(true);
        when(accessGrantRepository.findByDocument_IdAndUser_Id(documentId, ancestorOwnerId))
                .thenReturn(Optional.empty());
        when(userRepository.findById(ancestorOwnerId)).thenReturn(Optional.of(ancestorOwner));
        when(userDocumentOrderRepository.findMinOrderKeyByUserId(ancestorOwnerId, documentId))
                .thenReturn(Optional.empty());
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of());

        sharingService.updateCollaboratorAccess(
                actorId, documentId, ancestorOwnerId, new CollaboratorAccessUpdateRequest(DocumentAccessLevel.VIEW));

        ArgumentCaptor<User> actor = ArgumentCaptor.forClass(User.class);
        verify(accessGrantSyncService).upsertUserGrant(any(), any(), eq(DocumentAccessLevel.VIEW), actor.capture());
        assertEquals(actorId, actor.getValue().getId());
    }

    @Test
    void updateCollaboratorAccess_workspaceAudienceReaderCanBeDenied() {
        UUID actorId = UUID.randomUUID();
        UUID memberId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        User owner = User.builder().id(actorId).build();
        Document document = Document.builder()
                .id(documentId)
                .user(owner)
                .workspaceAccessMode(DocumentWorkspaceAccessMode.WORKSPACE_MEMBERS)
                .workspaceAccessLevel(DocumentAccessLevel.VIEW)
                .build();
        User member = User.builder().id(memberId).build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(document);
        when(accessGrantRepository.hasPositiveIdentityGrant(memberId, documentId))
                .thenReturn(true);
        when(accessGrantRepository.findByDocument_IdAndUser_Id(documentId, memberId))
                .thenReturn(Optional.empty());
        when(userRepository.findById(memberId)).thenReturn(Optional.of(member));
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of());

        sharingService.updateCollaboratorAccess(
                actorId, documentId, memberId, new CollaboratorAccessUpdateRequest(DocumentAccessLevel.NO_ACCESS));

        verify(accessGrantSyncService)
                .upsertUserGrant(eq(document), eq(member), eq(DocumentAccessLevel.NO_ACCESS), eq(owner));
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
        when(accessGrantRepository.hasPositiveIdentityGrant(bobId, documentId)).thenReturn(true);
        when(accessGrantRepository.findByDocument_IdAndUser_Id(documentId, bobId))
                .thenReturn(Optional.empty());
        when(userRepository.findById(bobId)).thenReturn(Optional.of(bob));
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of());

        sharingService.updateCollaboratorAccess(
                ownerId, documentId, bobId, new CollaboratorAccessUpdateRequest(DocumentAccessLevel.NO_ACCESS));

        verify(accessGrantSyncService).upsertUserGrant(any(), any(), eq(DocumentAccessLevel.NO_ACCESS), any());
        verify(userDocumentOrderRepository).deleteByUser_IdAndDocument_Id(bobId, documentId);
        verify(accessGrantRepository).pruneOrphanedBreakpoints(documentId);
    }

    @Test
    void updateCollaboratorAccess_withNoAccess_andNoAncestorGrant_deletesRowAndOrder() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID bobId = UUID.randomUUID();

        User owner = User.builder().id(ownerId).build();
        Document doc = Document.builder().id(documentId).user(owner).build();
        User bob = User.builder().id(bobId).build();
        AccessGrant existing = AccessGrant.builder()
                .document(doc)
                .user(bob)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.VIEW)
                .build();

        when(permissionService.requireSharingAdminAccess(ownerId, documentId)).thenReturn(doc);
        when(accessGrantRepository.hasPositiveIdentityGrant(bobId, documentId)).thenReturn(false);
        when(accessGrantRepository.findByDocument_IdAndUser_Id(documentId, bobId))
                .thenReturn(Optional.of(existing));
        when(userRepository.findById(bobId)).thenReturn(Optional.of(bob));
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of());

        sharingService.updateCollaboratorAccess(
                ownerId, documentId, bobId, new CollaboratorAccessUpdateRequest(DocumentAccessLevel.NO_ACCESS));

        verify(accessGrantRepository).deleteByDocument_IdAndUser_Id(documentId, bobId);
        verify(userDocumentOrderRepository).deleteByUser_IdAndDocument_Id(bobId, documentId);
        verify(accessGrantRepository).pruneOrphanedBreakpoints(documentId);
    }

    @Test
    void updateCollaboratorAccess_withNoAccess_andLinkOnlyGrant_deletesRowWithoutStoringBreakpoint() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID bobId = UUID.randomUUID();

        User owner = User.builder().id(ownerId).build();
        Document doc = Document.builder()
                .id(documentId)
                .user(owner)
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.VIEW)
                .build();
        User bob = User.builder().id(bobId).build();
        AccessGrant existing = AccessGrant.builder()
                .document(doc)
                .user(bob)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.VIEW)
                .build();

        when(permissionService.requireSharingAdminAccess(ownerId, documentId)).thenReturn(doc);
        // Link grants never count as ancestor grants, so even a live link leaves
        // hasPositiveIdentityGrant false and no breakpoint row is stored.
        when(accessGrantRepository.hasPositiveIdentityGrant(bobId, documentId)).thenReturn(false);
        when(accessGrantRepository.findByDocument_IdAndUser_Id(documentId, bobId))
                .thenReturn(Optional.of(existing));
        when(userRepository.findById(bobId)).thenReturn(Optional.of(bob));
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of());

        sharingService.updateCollaboratorAccess(
                ownerId, documentId, bobId, new CollaboratorAccessUpdateRequest(DocumentAccessLevel.NO_ACCESS));

        verify(accessGrantRepository).deleteByDocument_IdAndUser_Id(documentId, bobId);
        verify(userDocumentOrderRepository).deleteByUser_IdAndDocument_Id(bobId, documentId);

        verify(accessGrantRepository).pruneOrphanedBreakpoints(documentId);
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
        when(accessGrantRepository.existsByDocument_IdAndUser_Id(documentId, ancestorOwnerId))
                .thenReturn(true);
        when(userRepository.findById(ancestorOwnerId)).thenReturn(Optional.of(ancestorOwner));
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of());

        sharingService.removeCollaborator(actorId, documentId, ancestorOwnerId);

        verify(accessGrantRepository).deleteByDocument_IdAndUser_Id(documentId, ancestorOwnerId);
        verify(userDocumentOrderRepository).deleteByUser_IdAndDocument_Id(ancestorOwnerId, documentId);
        verify(accessGrantRepository).pruneOrphanedBreakpoints(documentId);
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
        when(accessGrantRepository.findByDocument_IdAndUser_Id(documentId, userId))
                .thenReturn(Optional.of(
                        AccessGrant.builder().effect(AccessGrantEffect.ALLOW).build()));
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of());

        sharingService.leaveSharedDocument(userId, documentId);

        verify(accessGrantRepository).deleteByDocument_IdAndUser_Id(documentId, userId);
        verify(userDocumentOrderRepository).deleteByUser_IdAndDocument_Id(userId, documentId);
        verify(accessGrantRepository).pruneOrphanedBreakpoints(documentId);
    }

    @Test
    void leaveSharedDocument_denyWithLiveLinkCannotRemoveAdminRevocation() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID ownerId = UUID.randomUUID();
        Document document = Document.builder()
                .id(documentId)
                .user(User.builder().id(ownerId).build())
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.VIEW)
                .build();
        AccessGrant deny = AccessGrant.builder().effect(AccessGrantEffect.DENY).build();

        when(permissionService.requireReadAccessIncludingTrash(userId, documentId))
                .thenReturn(document);
        when(accessGrantRepository.findByDocument_IdAndUser_Id(documentId, userId))
                .thenReturn(Optional.of(deny));

        ApiException ex =
                assertThrows(ApiException.class, () -> sharingService.leaveSharedDocument(userId, documentId));

        assertEquals(ErrorCode.CONFLICT, ex.getErrorCode());
        verify(accessGrantRepository, never()).deleteByDocument_IdAndUser_Id(documentId, userId);
    }

    @Test
    void leaveSharedDocument_linkOnlyAccessDoesNotKeepSharedOrderRow() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID ownerId = UUID.randomUUID();
        User user = User.builder().id(userId).build();
        Document document = Document.builder()
                .id(documentId)
                .user(User.builder().id(ownerId).build())
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.VIEW)
                .build();
        AccessGrant directGrant =
                AccessGrant.builder().effect(AccessGrantEffect.ALLOW).build();
        Map<UUID, DocumentAccessLevel> identityAccess = new HashMap<>();
        identityAccess.put(documentId, null);

        when(permissionService.requireReadAccessIncludingTrash(userId, documentId))
                .thenReturn(document);
        when(accessGrantRepository.findByDocument_IdAndUser_Id(documentId, userId))
                .thenReturn(Optional.of(directGrant));
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of(documentId));
        when(documentRepository.findParentIdsByIdIn(any()))
                .thenReturn(List.<Object[]>of(new Object[] {documentId, null}));
        when(documentRepository.findAllWithUserByIdIn(any())).thenReturn(List.of(document));
        when(permissionService.resolveIdentityAccessBatch(eq(userId), any())).thenReturn(identityAccess);

        sharingService.leaveSharedDocument(userId, documentId);

        verify(permissionService).resolveIdentityAccessBatch(eq(userId), any());
        verify(permissionService, never()).resolveAccessBatch(eq(userId), any());
        verify(userDocumentOrderRepository, times(2)).deleteByUser_IdAndDocument_Id(userId, documentId);
        verify(userDocumentOrderRepository, never()).findMinOrderKeyByUserId(userId, documentId);
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
        when(accessGrantRepository.findUserGrantsByDocumentId(childDocId)).thenReturn(List.of());
        // The chain reports the trashed parent and the live grandparent, but the trashed
        // ancestor stops resolution before its rows are ever loaded.
        when(documentRepository.findAncestorChainIds(childDocId))
                .thenReturn(List.of(trashedParentId, grandparentDocId));
        when(documentRepository.findAllWithUserByIdIn(List.of(trashedParentId, grandparentDocId)))
                .thenReturn(List.of(trashedParent, grandparent));

        List<CollaboratorResponse> result = sharingService.listCollaborators(ownerId, childDocId);

        assertEquals(1, result.size());
        assertEquals(ownerId, result.get(0).userId());
        // The walk must stop at the trashed parent instead of surfacing live grandparent grants.
        verify(accessGrantRepository, never()).findUserGrantsByDocumentIdIn(any());
    }

    /**
     * Stubs the batched ancestor load used by the sharing views: the recursive chain query,
     * the batch document fetch (owner included) and - only when the caller supplies any -
     * the batch ancestor-grant fetch, which just the collaborator list needs.
     * {@code ancestors} is ordered closest first, as {@code findAncestorChainIds} returns
     * them, and holds only the ancestors reachable from the target document.
     */
    private void stubAncestorChain(Document target, List<Document> ancestors, List<AccessGrant> rows) {
        List<UUID> ancestorIds = ancestors.stream().map(Document::getId).toList();
        when(documentRepository.findAncestorChainIds(target.getId())).thenReturn(ancestorIds);
        if (ancestorIds.isEmpty()) {
            return;
        }
        when(documentRepository.findAllWithUserByIdIn(ancestorIds)).thenReturn(ancestors);
        if (!rows.isEmpty()) {
            when(accessGrantRepository.findUserGrantsByDocumentIdIn(ancestorIds))
                    .thenReturn(rows);
        }
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

    @Test
    void listCollaborators_spaceRootDocument_surfacesSpaceMembersWithViaProvenance() {
        UUID requesterId = UUID.randomUUID();
        UUID spaceId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        Space space = Space.builder()
                .id(spaceId)
                .name("Engineering")
                .accessMode(SpaceAccessMode.CUSTOM)
                .build();

        User creator = User.builder()
                .id(requesterId)
                .email("creator@example.com")
                .displayName("Creator")
                .build();

        User memberUser = User.builder()
                .id(UUID.randomUUID())
                .email("member@example.com")
                .displayName("Member")
                .build();

        Document doc = Document.builder()
                .id(documentId)
                .title("Architecture")
                .user(creator)
                .space(space)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        SpaceMember sm = SpaceMember.builder()
                .id(UUID.randomUUID())
                .space(space)
                .user(memberUser)
                .accessLevel(DocumentAccessLevel.EDIT)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(permissionService.requireReadAccessIncludingTrash(requesterId, documentId))
                .thenReturn(doc);
        when(permissionService.resolveSpace(doc)).thenReturn(space);
        when(spaceAccessService.load(requesterId, spaceId))
                .thenReturn(new SpaceContext(space, WorkspaceRole.MEMBER, DocumentAccessLevel.EDIT));
        when(spaceMemberRepository.findAllBySpace_IdOrderByCreatedAtAsc(spaceId))
                .thenReturn(List.of(sm));
        when(accessGrantRepository.findUserGrantsByDocumentId(documentId)).thenReturn(List.of());
        when(documentRepository.findAncestorChainIds(documentId)).thenReturn(List.of());

        List<CollaboratorResponse> roster = sharingService.listCollaborators(requesterId, documentId);

        assertEquals(1, roster.size());
        CollaboratorResponse row = roster.get(0);
        assertEquals(memberUser.getId(), row.userId());
        assertEquals("Engineering", row.inheritedFromTitle());
        assertEquals(spaceId, row.inheritedFromId());
        assertTrue(row.inherited());
        assertEquals(DocumentAccessLevel.EDIT, row.accessLevel());
    }

    @Test
    void listCollaborators_directOverrideOnSpaceMember_reportsOverridesSpaceProvenance() {
        UUID requesterId = UUID.randomUUID();
        UUID spaceId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID memberId = UUID.randomUUID();

        Space space = Space.builder()
                .id(spaceId)
                .name("Product")
                .accessMode(SpaceAccessMode.CUSTOM)
                .build();

        User creator = User.builder()
                .id(requesterId)
                .email("creator@example.com")
                .displayName("Creator")
                .build();

        User memberUser = User.builder()
                .id(memberId)
                .email("member@example.com")
                .displayName("Member")
                .build();

        Document doc = Document.builder()
                .id(documentId)
                .title("Roadmap")
                .user(creator)
                .space(space)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        SpaceMember sm = SpaceMember.builder()
                .id(UUID.randomUUID())
                .space(space)
                .user(memberUser)
                .accessLevel(DocumentAccessLevel.EDIT)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        AccessGrant directOverride = AccessGrant.builder()
                .id(UUID.randomUUID())
                .document(doc)
                .user(memberUser)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.VIEW)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(permissionService.requireReadAccessIncludingTrash(requesterId, documentId))
                .thenReturn(doc);
        when(permissionService.resolveSpace(doc)).thenReturn(space);
        when(spaceAccessService.load(requesterId, spaceId))
                .thenReturn(new SpaceContext(space, WorkspaceRole.MEMBER, DocumentAccessLevel.EDIT));
        when(spaceMemberRepository.findAllBySpace_IdOrderByCreatedAtAsc(spaceId))
                .thenReturn(List.of(sm));
        when(accessGrantRepository.findUserGrantsByDocumentId(documentId)).thenReturn(List.of(directOverride));
        when(documentRepository.findAncestorChainIds(documentId)).thenReturn(List.of());

        List<CollaboratorResponse> roster = sharingService.listCollaborators(requesterId, documentId);

        assertEquals(1, roster.size());
        CollaboratorResponse row = roster.get(0);
        assertEquals(memberId, row.userId());
        assertFalse(row.inherited());
        assertEquals("Product", row.inheritedFromTitle());
        assertEquals(spaceId, row.inheritedFromId());
        assertEquals(DocumentAccessLevel.EDIT, row.inheritedAccessLevel());
        assertEquals(DocumentAccessLevel.VIEW, row.accessLevel());
    }

    @Test
    void getMyAccess_externalCollaboratorNotInWorkspace_returnsAccessWithoutSpaceSummary() {
        UUID requesterId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID spaceId = UUID.randomUUID();
        Space space = Space.builder().id(spaceId).name("Engineering").build();
        Document document = createSharedDocument(documentId, DocumentAccessLevel.EDIT);

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(document));
        when(permissionService.resolveAccess(requesterId, documentId)).thenReturn(DocumentAccessLevel.EDIT);
        when(permissionService.resolveSpace(document)).thenReturn(space);
        when(spaceAccessService.load(requesterId, spaceId)).thenThrow(new ApiException(ErrorCode.NOT_FOUND));

        DocumentAccessResponse response = sharingService.getMyAccess(requesterId, documentId);

        assertTrue(response.allowed());
        assertEquals(DocumentAccessLevel.EDIT, response.accessLevel());
        assertFalse(response.owner());
        assertFalse(response.canManageSharing());
        assertNull(response.space());
    }

    @Test
    void getMyAccess_spacePageOwner_reportsSharingRightsEvenWithoutSpaceAdministration() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID spaceId = UUID.randomUUID();
        Space space = Space.builder()
                .id(spaceId)
                .name("Engineering")
                .accessMode(SpaceAccessMode.CUSTOM)
                .build();
        Document document =
                Document.builder().id(documentId).title("Roadmap").space(space).build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(document));
        when(permissionService.resolveAccess(userId, documentId)).thenReturn(DocumentAccessLevel.OWNER);
        when(permissionService.resolveSpace(document)).thenReturn(space);
        when(spaceAccessService.load(userId, spaceId))
                .thenReturn(new SpaceContext(space, WorkspaceRole.MEMBER, DocumentAccessLevel.EDIT));

        DocumentAccessResponse response = sharingService.getMyAccess(userId, documentId);

        assertTrue(response.allowed());
        assertEquals(DocumentAccessLevel.OWNER, response.accessLevel());
        assertFalse(response.owner());
        assertTrue(response.canManageSharing());
        assertNotNull(response.space());
        assertEquals(DocumentAccessLevel.EDIT, response.space().myAccessLevel());
        assertFalse(response.space().canAdminister());
    }

    @Test
    void getMyAccess_externalPageOwnerOnASpacePage_canManageSharingWithoutSpaceSummary() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID spaceId = UUID.randomUUID();
        Space space = Space.builder().id(spaceId).name("Engineering").build();
        Document document =
                Document.builder().id(documentId).title("Roadmap").space(space).build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(document));
        when(permissionService.resolveAccess(userId, documentId)).thenReturn(DocumentAccessLevel.OWNER);
        when(permissionService.resolveSpace(document)).thenReturn(space);
        when(spaceAccessService.load(userId, spaceId)).thenThrow(new ApiException(ErrorCode.NOT_FOUND));

        DocumentAccessResponse response = sharingService.getMyAccess(userId, documentId);

        assertTrue(response.allowed());
        assertEquals(DocumentAccessLevel.OWNER, response.accessLevel());
        assertFalse(response.owner());
        assertTrue(response.canManageSharing());
        assertNull(response.space());
    }

    @Test
    void getCollaborators_creatorRemovedFromSpaceWithPublicLink_deniesRosterAccess() {
        UUID creatorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID spaceId = UUID.randomUUID();
        Space space = Space.builder().id(spaceId).name("Engineering").build();
        User creator = User.builder().id(creatorId).email("creator@example.com").build();
        Document document = Document.builder()
                .id(documentId)
                .user(creator)
                .title("Space doc")
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .build();

        when(permissionService.requireReadAccessIncludingTrash(creatorId, documentId))
                .thenReturn(document);
        when(permissionService.resolveSpace(document)).thenReturn(space);
        when(accessGrantRepository.hasPositiveIdentityGrant(creatorId, documentId))
                .thenReturn(false);
        when(spaceAccessService.load(creatorId, spaceId)).thenThrow(new ApiException(ErrorCode.NOT_FOUND));

        assertThrows(ApiException.class, () -> sharingService.listCollaborators(creatorId, documentId));
    }

    @Test
    void getMyAccess_externalPageOwnerInArchivedSpace_cannotManageSharing() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID spaceId = UUID.randomUUID();
        Space space = Space.builder()
                .id(spaceId)
                .name("Engineering")
                .archivedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();
        Document document =
                Document.builder().id(documentId).title("Roadmap").space(space).build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(document));
        when(permissionService.resolveAccess(userId, documentId)).thenReturn(DocumentAccessLevel.OWNER);
        when(permissionService.resolveSpace(document)).thenReturn(space);
        when(spaceAccessService.load(userId, spaceId)).thenThrow(new ApiException(ErrorCode.NOT_FOUND));

        DocumentAccessResponse response = sharingService.getMyAccess(userId, documentId);

        assertTrue(response.allowed());
        assertEquals(DocumentAccessLevel.OWNER, response.accessLevel());
        assertFalse(response.owner());
        assertFalse(response.canManageSharing());
        assertNull(response.space());
    }

    @Test
    void listCollaborators_publicSpace_workspaceMemberNotListedInSpaceDoesNotGetSpaceRoster() {
        UUID requesterId = UUID.randomUUID();
        UUID spaceId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID memberId = UUID.randomUUID();

        Space space = Space.builder()
                .id(spaceId)
                .name("Public Company Docs")
                .accessMode(SpaceAccessMode.PUBLIC)
                .everyoneAccessLevel(DocumentAccessLevel.VIEW)
                .build();

        User memberUser = User.builder()
                .id(memberId)
                .email("space-member@example.com")
                .displayName("Space Member")
                .build();

        Document doc = Document.builder()
                .id(documentId)
                .title("Handbook")
                .space(space)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(permissionService.requireReadAccessIncludingTrash(requesterId, documentId))
                .thenReturn(doc);
        when(permissionService.resolveSpace(doc)).thenReturn(space);
        when(accessGrantRepository.hasPositiveIdentityGrant(requesterId, documentId))
                .thenReturn(true);
        when(spaceMemberRepository.existsBySpace_IdAndUser_Id(spaceId, requesterId))
                .thenReturn(false);
        when(spaceAccessService.load(requesterId, spaceId))
                .thenReturn(new SpaceContext(space, WorkspaceRole.MEMBER, DocumentAccessLevel.VIEW));
        when(accessGrantRepository.findUserGrantsByDocumentId(documentId)).thenReturn(List.of());
        when(documentRepository.findAncestorChainIds(documentId)).thenReturn(List.of());

        List<CollaboratorResponse> roster = sharingService.listCollaborators(requesterId, documentId);

        assertTrue(roster.isEmpty());
    }

    @Test
    void getSharingSettings_ownLiveLinkWinsOverOwnLinkInheritBlocked() {
        UUID actorId = UUID.randomUUID();
        UUID docId = UUID.randomUUID();
        Document doc = Document.builder()
                .id(docId)
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.EDIT)
                .linkInheritBlocked(true)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, docId)).thenReturn(doc);
        when(documentRepository.findAncestorChainIds(docId)).thenReturn(List.of());

        SharingSettingsResponse response = settingsService.getSharingSettings(actorId, docId);

        assertTrue(response.hasActiveLink());
        assertFalse(response.linkInheritBlocked());
        assertEquals(DocumentAccessLevel.EDIT, response.linkAccessLevel());
    }

    @Test
    void updateSharingSettings_pastLinkExpiresAt_throwsValidationFailed() {
        UUID actorId = UUID.randomUUID();
        UUID docId = UUID.randomUUID();
        Document doc = Document.builder()
                .id(docId)
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.VIEW)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, docId)).thenReturn(doc);

        SharingSettingsUpdateRequest request = new SharingSettingsUpdateRequest(
                DocumentGeneralAccessMode.ANYONE_WITH_LINK,
                DocumentAccessLevel.VIEW,
                null,
                null,
                null,
                null,
                OffsetDateTime.now(ZoneOffset.UTC).minusDays(1),
                null);

        ApiException ex =
                assertThrows(ApiException.class, () -> settingsService.updateSharingSettings(actorId, docId, request));
        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
    }

    @Test
    void updateSharingSettings_linkExpiresAtAndClearExpiryTogether_throwsValidationFailed() {
        UUID actorId = UUID.randomUUID();
        UUID docId = UUID.randomUUID();
        Document doc = Document.builder()
                .id(docId)
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, docId)).thenReturn(doc);

        SharingSettingsUpdateRequest request = new SharingSettingsUpdateRequest(
                DocumentGeneralAccessMode.ANYONE_WITH_LINK,
                DocumentAccessLevel.VIEW,
                false,
                null,
                null,
                false,
                OffsetDateTime.now(ZoneOffset.UTC).plusDays(7),
                true);

        ApiException ex =
                assertThrows(ApiException.class, () -> settingsService.updateSharingSettings(actorId, docId, request));
        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
        assertEquals("linkExpiresAt and clearLinkExpiresAt cannot be used together.", ex.getMessage());
    }

    @Test
    void updateSharingSettings_workspaceMembersWithInheritBlocked_throwsValidationFailed() {
        UUID actorId = UUID.randomUUID();
        UUID docId = UUID.randomUUID();
        Document doc = Document.builder().id(docId).build();

        when(permissionService.requireSharingAdminAccess(actorId, docId)).thenReturn(doc);

        SharingSettingsUpdateRequest request = new SharingSettingsUpdateRequest(
                null,
                null,
                null,
                DocumentWorkspaceAccessMode.WORKSPACE_MEMBERS,
                DocumentAccessLevel.VIEW,
                true,
                null,
                null);

        ApiException ex =
                assertThrows(ApiException.class, () -> settingsService.updateSharingSettings(actorId, docId, request));
        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
    }

    @Test
    void updateCollaboratorAccess_positiveLevel_doesNotPruneBreakpoints() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID bobId = UUID.randomUUID();

        User owner = User.builder().id(ownerId).build();
        User bob = User.builder().id(bobId).build();
        Document document = Document.builder().id(documentId).user(owner).build();
        AccessGrant existing = AccessGrant.builder()
                .id(UUID.randomUUID())
                .document(document)
                .user(bob)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.VIEW)
                .build();

        when(permissionService.requireSharingAdminAccess(ownerId, documentId)).thenReturn(document);
        when(accessGrantRepository.hasPositiveIdentityGrant(bobId, documentId)).thenReturn(true);
        when(accessGrantRepository.findByDocument_IdAndUser_Id(documentId, bobId))
                .thenReturn(Optional.of(existing));
        when(userRepository.findById(bobId)).thenReturn(Optional.of(bob));
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of());

        sharingService.updateCollaboratorAccess(
                ownerId, documentId, bobId, new CollaboratorAccessUpdateRequest(DocumentAccessLevel.EDIT));

        verify(accessGrantSyncService).upsertUserGrant(any(), any(), eq(DocumentAccessLevel.EDIT), any());
        verify(accessGrantRepository, never()).pruneOrphanedBreakpoints(any());
    }
}
