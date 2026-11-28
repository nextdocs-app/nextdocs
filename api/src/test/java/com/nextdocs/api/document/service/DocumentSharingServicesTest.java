package com.nextdocs.api.document.service;

import static org.assertj.core.api.Assertions.assertThat;
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
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.nextdocs.api.audit.entity.AccessAuditAction;
import com.nextdocs.api.audit.service.AccessAuditService;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.dto.request.CollaboratorAccessUpdateRequest;
import com.nextdocs.api.document.dto.request.CollaboratorUpsertRequest;
import com.nextdocs.api.document.dto.request.SharingSettingsUpdateRequest;
import com.nextdocs.api.document.dto.response.CollaboratorResponse;
import com.nextdocs.api.document.dto.response.DocumentAccessResponse;
import com.nextdocs.api.document.dto.response.SharingSettingsResponse;
import com.nextdocs.api.document.dto.response.SharingSourceKind;
import com.nextdocs.api.document.entity.AccessGrant;
import com.nextdocs.api.document.entity.AccessGrantEffect;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.entity.DocumentGeneralAccessMode;
import com.nextdocs.api.document.entity.DocumentWorkspaceAccessMode;
import com.nextdocs.api.document.repository.AccessGrantRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.repository.UserSharedOrderRepository;
import com.nextdocs.api.realtime.client.YhubClient;
import com.nextdocs.api.realtime.event.DocumentAccessChangedEvent;
import com.nextdocs.api.realtime.service.RealtimeAccessScopeResolver;
import com.nextdocs.api.realtime.service.RealtimeRevocationNotifier;
import com.nextdocs.api.space.entity.Space;
import com.nextdocs.api.space.entity.SpaceAccessMode;
import com.nextdocs.api.space.entity.SpaceMember;
import com.nextdocs.api.space.repository.SpaceMemberRepository;
import com.nextdocs.api.space.service.SpaceAccessService;
import com.nextdocs.api.space.service.SpaceAccessService.SpaceContext;
import com.nextdocs.api.user.entity.User;
import com.nextdocs.api.user.repository.UserRepository;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import com.nextdocs.api.workspace.repository.WorkspaceRepository;
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
import org.mockito.Mockito;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;

@ExtendWith(MockitoExtension.class)
class DocumentSharingServicesTest {

    @Mock
    private DocumentRepository documentRepository;

    @Mock
    private AccessGrantRepository accessGrantRepository;

    @Mock
    private UserSharedOrderRepository userSharedOrderRepository;

    @Mock
    private SharedSectionService sharedSectionService;

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

    @Mock
    private WorkspaceRepository workspaceRepository;

    private DocumentSharingService sharingService;
    private DocumentSharingSettingsService settingsService;
    /** Events published by the mutation under test, asserted where access changes. */
    private final List<Object> publishedEvents = new java.util.ArrayList<>();

    @BeforeEach
    void setUp() {
        publishedEvents.clear();
        DocumentOwnershipService ownershipService = new DocumentOwnershipService(
                documentRepository, accessGrantRepository, permissionService, spaceMemberRepository);
        sharingService = new DocumentSharingService(
                documentRepository,
                accessGrantRepository,
                userSharedOrderRepository,
                sharedSectionService,
                userRepository,
                permissionService,
                spaceAccessService,
                spaceMemberRepository,
                ownershipService,
                accessGrantSyncService,
                auditService,
                publishedEvents::add,
                workspaceRepository);
        settingsService = new DocumentSharingSettingsService(
                documentRepository,
                accessGrantRepository,
                permissionService,
                auditService,
                sharedSectionService,
                spaceAccessService,
                publishedEvents::add);

        // A space source is only named when the caller can find the space.
        org.mockito.Mockito.lenient()
                .when(spaceAccessService.visibleSpaceIds(any(), any()))
                .thenReturn(java.util.Set.of());

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
    }

    @Test
    void getMyAccess_privatePageWorkspaceAdmin_cannotManageSharing() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = Document.builder()
                .id(documentId)
                .creator(User.builder()
                        .id(UUID.randomUUID())
                        .passwordHash("$2a$12$hash")
                        .build())
                .workspace(
                        Workspace.builder().id(UUID.randomUUID()).name("Acme").build())
                .build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(document));
        when(permissionService.resolveAccess(userId, documentId)).thenReturn(DocumentAccessLevel.VIEW);
        when(permissionService.ownsAncestor(userId, document)).thenReturn(false);

        DocumentAccessResponse response = sharingService.getMyAccess(userId, documentId);

        assertTrue(response.allowed());
        assertFalse(response.canManageSharing());
    }

    @Test
    void getMyAccess_ancestorOwnerDemotedOnChild_keepsSharingRights() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID parentId = UUID.randomUUID();
        Document parent = Document.builder()
                .id(parentId)
                .creator(User.builder().id(userId).passwordHash("$2a$12$hash").build())
                .build();
        Document child = Document.builder()
                .id(documentId)
                .creator(User.builder()
                        .id(UUID.randomUUID())
                        .passwordHash("$2a$12$hash")
                        .build())
                .parent(parent)
                .build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(child));
        when(permissionService.resolveAccess(userId, documentId)).thenReturn(DocumentAccessLevel.EDIT);
        when(permissionService.resolveSpace(child)).thenReturn(null);
        when(permissionService.ownsAncestor(userId, child)).thenReturn(true);

        DocumentAccessResponse response = sharingService.getMyAccess(userId, documentId);

        assertTrue(response.canManageSharing());
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
                .creator(User.builder().id(ownerId).passwordHash("$2a$12$hash").build())
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
    }

    @Test
    void leaveSharedDocument_inAnArchivedSpace_isBlocked() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = Document.builder()
                .id(documentId)
                .creator(User.builder()
                        .id(UUID.randomUUID())
                        .passwordHash("$2a$12$hash")
                        .build())
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
                .creator(User.builder().id(ownerId).passwordHash("$2a$12$hash").build())
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(permissionService.requireSharingAdminAccess(ownerId, documentId)).thenReturn(trashed);
        when(accessGrantRepository.existsByDocument_IdAndUser_Id(documentId, collaboratorUserId))
                .thenReturn(true);

        sharingService.removeCollaborator(ownerId, documentId, collaboratorUserId);

        verify(accessGrantRepository).deleteByDocument_IdAndUser_Id(documentId, collaboratorUserId);
        verify(userSharedOrderRepository).deleteByUser_IdAndDocument_Id(collaboratorUserId, documentId);
    }

    @Test
    void listCollaborators_onTrashedDocument_allowsOwner() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document trashed = Document.builder()
                .id(documentId)
                .creator(User.builder()
                        .id(ownerId)
                        .email("owner@example.com")
                        .displayName("Owner")
                        .passwordHash("$2a$12$hash")
                        .build())
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        AccessGrant creatorGrant = ownerGrant(trashed, trashed.getCreator());
        when(permissionService.requireReadAccessIncludingTrash(ownerId, documentId))
                .thenReturn(trashed);
        when(accessGrantRepository.findUserGrantsByDocumentId(documentId)).thenReturn(List.of(creatorGrant));

        List<CollaboratorResponse> result = sharingService.listCollaborators(ownerId, documentId);

        assertEquals(1, result.size());
        assertEquals(ownerId, result.get(0).userId());
        assertEquals(DocumentAccessLevel.OWNER, result.get(0).accessLevel());
    }

    @Test
    void listCollaborators_hidesInaccessibleAncestorPeopleAndProvenance() {
        UUID viewerId = UUID.randomUUID();
        User owner =
                User.builder().id(UUID.randomUUID()).email("owner@example.com").build();
        User viewer = User.builder().id(viewerId).email("viewer@example.com").build();
        Document parent = Document.builder()
                .id(UUID.randomUUID())
                .creator(owner)
                .title("Secret")
                .build();
        Document child = Document.builder()
                .id(UUID.randomUUID())
                .creator(owner)
                .parent(parent)
                .build();
        AccessGrant direct = AccessGrant.builder()
                .document(child)
                .user(viewer)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.OWNER)
                .build();
        AccessGrant inherited = AccessGrant.builder()
                .document(parent)
                .user(viewer)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.EDIT)
                .build();

        when(permissionService.requireReadAccessIncludingTrash(viewerId, child.getId()))
                .thenReturn(child);
        when(accessGrantRepository.findUserGrantsByDocumentId(child.getId())).thenReturn(List.of(direct));
        stubAncestorChain(child, List.of(parent), List.of(inherited));

        List<CollaboratorResponse> roster = sharingService.listCollaborators(viewerId, child.getId());
        assertEquals(1, roster.size());
        assertEquals(viewerId, roster.get(0).userId());
        assertNull(roster.get(0).inheritedFromId());
        assertNull(roster.get(0).inheritedAccessLevel());
        assertTrue(sharingService.hasHiddenSharingSources(viewerId, child.getId()));
    }

    @Test
    void listCollaborators_privatePageWorkspaceAdminWithoutIdentityGrant_cannotReadRoster() {
        UUID ownerId = UUID.randomUUID();
        UUID adminId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document doc = Document.builder()
                .id(documentId)
                .creator(User.builder()
                        .id(ownerId)
                        .email("owner@example.com")
                        .displayName("Owner")
                        .passwordHash("$2a$12$hash")
                        .build())
                .workspace(
                        Workspace.builder().id(UUID.randomUUID()).name("Acme").build())
                .build();

        when(permissionService.requireReadAccessIncludingTrash(adminId, documentId))
                .thenReturn(doc);
        doThrow(new ApiException(ErrorCode.NOT_FOUND)).when(permissionService).requireRosterAccess(adminId, doc);

        ApiException exception =
                assertThrows(ApiException.class, () -> sharingService.listCollaborators(adminId, documentId));

        assertEquals(ErrorCode.NOT_FOUND, exception.getErrorCode());
    }

    @Test
    void listCollaborators_linkOnlyReader_cannotEnumerateRoster() {
        UUID ownerId = UUID.randomUUID();
        UUID linkOnlyId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document doc = Document.builder()
                .id(documentId)
                .creator(User.builder()
                        .id(ownerId)
                        .email("owner@example.com")
                        .displayName("Owner")
                        .passwordHash("$2a$12$hash")
                        .build())
                .build();

        when(permissionService.requireReadAccessIncludingTrash(linkOnlyId, documentId))
                .thenReturn(doc);
        // The identity rule itself lives in PermissionService (and is pinned there); this
        // asserts the roster stops as soon as that gate refuses a link-only reader.
        doThrow(new ApiException(ErrorCode.NOT_FOUND)).when(permissionService).requireRosterAccess(linkOnlyId, doc);

        assertThrows(ApiException.class, () -> sharingService.listCollaborators(linkOnlyId, documentId));
    }

    @Test
    void listCollaborators_inheritedGrantAndPageDenyWithLiveLinkKeepsBroadestAccessRoster() {
        UUID ownerId = UUID.randomUUID();
        UUID memberId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document doc = Document.builder()
                .id(documentId)
                .creator(User.builder()
                        .id(ownerId)
                        .email("owner@example.com")
                        .displayName("Owner")
                        .passwordHash("$2a$12$hash")
                        .build())
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.VIEW)
                .build();

        when(permissionService.requireReadAccessIncludingTrash(memberId, documentId))
                .thenReturn(doc);
        // The SQL regression test covers ancestor ALLOW + page DENY. The independent live
        // link grants page read while the identity gate admits the member.

        User memberUser = User.builder()
                .id(memberId)
                .email("member@example.com")
                .displayName("Member")
                .passwordHash("$2a$12$hash")
                .build();
        AccessGrant pageDeny = AccessGrant.builder()
                .user(memberUser)
                .effect(AccessGrantEffect.DENY)
                .build();

        when(accessGrantRepository.findUserGrantsByDocumentId(documentId))
                .thenReturn(List.of(ownerGrant(doc, doc.getCreator()), pageDeny));
        when(documentRepository.findAncestorChainIds(documentId)).thenReturn(List.of());
        List<CollaboratorResponse> roster = sharingService.listCollaborators(memberId, documentId);

        assertEquals(2, roster.size());
        assertEquals(ownerId, roster.get(0).userId());
        assertEquals(memberId, roster.get(1).userId());
        assertEquals(DocumentAccessLevel.NO_ACCESS, roster.get(1).accessLevel());
    }

    @Test
    void listCollaborators_workspaceAudienceReaderSeesTheCreatorRow() {
        UUID ownerId = UUID.randomUUID();
        UUID memberId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document doc = Document.builder()
                .id(documentId)
                .creator(User.builder().id(ownerId).passwordHash("$2a$12$hash").build())
                .workspaceAccessMode(DocumentWorkspaceAccessMode.WORKSPACE_MEMBERS)
                .workspaceAccessLevel(DocumentAccessLevel.VIEW)
                .build();

        when(permissionService.requireReadAccessIncludingTrash(memberId, documentId))
                .thenReturn(doc);
        AccessGrant creatorGrant = ownerGrant(doc, doc.getCreator());
        when(accessGrantRepository.findUserGrantsByDocumentId(documentId)).thenReturn(List.of(creatorGrant));
        when(documentRepository.findAncestorChainIds(documentId)).thenReturn(List.of());

        List<CollaboratorResponse> roster = sharingService.listCollaborators(memberId, documentId);

        assertEquals(1, roster.size());
        assertEquals(ownerId, roster.get(0).userId());
    }

    @Test
    void upsertCollaborator_givesTheRootAndOwnerASharedOrderRow() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        User owner = User.builder()
                .id(ownerId)
                .email("owner@example.com")
                .displayName("Owner")
                .passwordHash("$2a$12$hash")
                .build();

        Document document = Document.builder()
                .id(documentId)
                .creator(owner)
                .title("Shared doc")
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.VIEW)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .updatedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        User targetUser = User.builder()
                .id(UUID.randomUUID())
                .email("alice@example.com")
                .displayName("Alice")
                .passwordHash("$2a$12$hash")
                .build();

        when(permissionService.requireSharingAdminAccess(ownerId, documentId)).thenReturn(document);
        when(userRepository.findByEmail("alice@example.com")).thenReturn(Optional.of(targetUser));
        CollaboratorResponse response = sharingService.upsertCollaborator(
                ownerId, documentId, new CollaboratorUpsertRequest("alice@example.com", DocumentAccessLevel.EDIT));

        // A root share creates two Shared entries: the collaborator's and the owner's.
        verify(sharedSectionService).ensureOrderRow(targetUser, document);
        verify(sharedSectionService).ensureOrderRow(owner, document);

        assertEquals(targetUser.getId(), response.userId());
        assertNotNull(response.addedAt());
    }

    @Test
    void removeCollaborator_deletesTheCollaboratorsSharedOrderRow() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID collaboratorId = UUID.randomUUID();
        Document document = Document.builder()
                .id(documentId)
                .creator(User.builder().id(ownerId).passwordHash("$2a$12$hash").build())
                .build();

        when(permissionService.requireSharingAdminAccess(ownerId, documentId)).thenReturn(document);
        when(accessGrantRepository.existsByDocument_IdAndUser_Id(documentId, collaboratorId))
                .thenReturn(true);

        sharingService.removeCollaborator(ownerId, documentId, collaboratorId);

        verify(accessGrantRepository).deleteByDocument_IdAndUser_Id(documentId, collaboratorId);
        verify(userSharedOrderRepository).deleteByUser_IdAndDocument_Id(collaboratorId, documentId);

        assertEquals(1, publishedEvents.size());
        DocumentAccessChangedEvent event = (DocumentAccessChangedEvent) publishedEvents.get(0);
        assertEquals(documentId, event.documentId());
        assertEquals(List.of(collaboratorId), event.affectedUsers());
        assertTrue(event.subtree());
    }

    @Test
    void removeCollaborator_eventNotifiesYhubForTheRemovedCollaborator() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID collaboratorId = UUID.randomUUID();
        UUID descendantId = UUID.randomUUID();
        Document document = Document.builder()
                .id(documentId)
                .creator(User.builder().id(ownerId).passwordHash("$2a$12$hash").build())
                .build();

        when(permissionService.requireSharingAdminAccess(ownerId, documentId)).thenReturn(document);
        when(accessGrantRepository.existsByDocument_IdAndUser_Id(documentId, collaboratorId))
                .thenReturn(true);

        sharingService.removeCollaborator(ownerId, documentId, collaboratorId);

        // The event captured above is what the after-commit listener receives. Running
        // it through the real listener pins the Yhub notification (subtree + user) that
        // closes the removed collaborator's open socket.
        YhubClient yhubClient = mock(YhubClient.class);
        RealtimeAccessScopeResolver scopeResolver = mock(RealtimeAccessScopeResolver.class);
        when(scopeResolver.forDocument(documentId)).thenReturn(List.of(documentId, descendantId));
        RealtimeRevocationNotifier notifier = new RealtimeRevocationNotifier(yhubClient, scopeResolver);

        for (Object published : publishedEvents) {
            notifier.onAccessChanged((DocumentAccessChangedEvent) published);
        }

        verify(scopeResolver).forDocument(documentId);
        verify(yhubClient).recheck(List.of(documentId, descendantId), List.of(collaboratorId));
    }

    @Test
    void upsertCollaborator_givesOnlyTheCollaboratorASharedOrderRow() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        User owner = User.builder()
                .id(ownerId)
                .email("owner@example.com")
                .displayName("Owner")
                .passwordHash("$2a$12$hash")
                .build();

        Document parent = Document.builder()
                .id(UUID.randomUUID())
                .creator(owner)
                .title("Parent")
                .build();
        Document document = Document.builder()
                .id(documentId)
                .creator(owner)
                .title("Nested shared doc")
                .parent(parent)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .updatedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        User targetUser = User.builder()
                .id(UUID.randomUUID())
                .email("alice@example.com")
                .displayName("Alice")
                .passwordHash("$2a$12$hash")
                .build();

        when(permissionService.requireSharingAdminAccess(ownerId, documentId)).thenReturn(document);
        when(userRepository.findByEmail("alice@example.com")).thenReturn(Optional.of(targetUser));
        sharingService.upsertCollaborator(
                ownerId, documentId, new CollaboratorUpsertRequest("alice@example.com", DocumentAccessLevel.EDIT));

        // A nested page has no owner Shared entry; only the collaborator floats.
        verify(sharedSectionService).ensureOrderRow(targetUser, document);
    }

    @Test
    void upsertCollaborator_retriesADuplicatePositionFailure() {
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        CollaboratorUpsertRequest request =
                new CollaboratorUpsertRequest("alice@example.com", DocumentAccessLevel.EDIT);
        CollaboratorResponse response = new CollaboratorResponse(
                UUID.randomUUID(), "alice@example.com", "Alice", null, DocumentAccessLevel.EDIT, OffsetDateTime.now());

        DocumentSharingService spy = Mockito.spy(sharingService);
        doThrow(
                        new DataIntegrityViolationException(
                                "could not execute statement",
                                new RuntimeException(
                                        "ERROR: duplicate key value violates unique constraint \"idx_user_document_orders_user_order_key\"")))
                .doReturn(response)
                .when(spy)
                .upsertCollaboratorAndPersist(actorId, documentId, request);

        assertEquals(response, spy.upsertCollaborator(actorId, documentId, request));
        verify(spy, times(2)).upsertCollaboratorAndPersist(actorId, documentId, request);
    }

    @Test
    void upsertCollaborator_doesNotRetryANonPositionFailure() {
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        CollaboratorUpsertRequest request =
                new CollaboratorUpsertRequest("alice@example.com", DocumentAccessLevel.EDIT);

        DocumentSharingService spy = Mockito.spy(sharingService);
        doThrow(
                        new DataIntegrityViolationException(
                                "could not execute statement",
                                new RuntimeException(
                                        "ERROR: null value in column \"order_key\" of relation \"user_shared_document_orders\" violates not-null constraint")))
                .when(spy)
                .upsertCollaboratorAndPersist(actorId, documentId, request);

        assertThrows(DataIntegrityViolationException.class, () -> spy.upsertCollaborator(actorId, documentId, request));
        verify(spy, times(1)).upsertCollaboratorAndPersist(actorId, documentId, request);
    }

    @Test
    void upsertCollaborator_allowsOwnerLevelForCollaborators() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        User owner = User.builder()
                .id(ownerId)
                .email("owner@example.com")
                .passwordHash("$2a$12$hash")
                .build();

        Document document = Document.builder().id(documentId).creator(owner).build();
        User targetUser = User.builder()
                .id(UUID.randomUUID())
                .email("fullaccess@example.com")
                .passwordHash("$2a$12$hash")
                .build();

        when(permissionService.requireSharingAdminAccess(ownerId, documentId)).thenReturn(document);
        when(userRepository.findByEmail("fullaccess@example.com")).thenReturn(Optional.of(targetUser));
        CollaboratorResponse response = sharingService.upsertCollaborator(
                ownerId,
                documentId,
                new CollaboratorUpsertRequest("fullaccess@example.com", DocumentAccessLevel.OWNER));

        assertEquals(DocumentAccessLevel.OWNER, response.accessLevel());
        assertFalse(response.inherited());
    }

    @Test
    void upsertCollaborator_actorDifferentFromDocOwner_setsGrantedByToActor() {
        UUID docOwnerId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        User docOwner = User.builder()
                .id(docOwnerId)
                .email("owner@example.com")
                .passwordHash("$2a$12$hash")
                .build();

        Document document = Document.builder().id(documentId).creator(docOwner).build();

        User actor = User.builder()
                .id(actorId)
                .email("actor@example.com")
                .passwordHash("$2a$12$hash")
                .build();

        User targetUser = User.builder()
                .id(UUID.randomUUID())
                .email("newbie@example.com")
                .passwordHash("$2a$12$hash")
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(document);
        when(userRepository.findByEmail("newbie@example.com")).thenReturn(Optional.of(targetUser));
        when(userRepository.findById(actorId)).thenReturn(Optional.of(actor));

        CollaboratorResponse response = sharingService.upsertCollaborator(
                actorId, documentId, new CollaboratorUpsertRequest("newbie@example.com", DocumentAccessLevel.VIEW));

        verify(accessGrantSyncService).upsertUserGrant(document, targetUser, DocumentAccessLevel.VIEW, actor);
        var inOrder = Mockito.inOrder(documentRepository, permissionService);
        inOrder.verify(documentRepository).findByIdForOwnershipUpdate(documentId);
        inOrder.verify(permissionService).requireSharingAdminAccess(actorId, documentId);
        assertEquals(targetUser.getId(), response.userId());
    }

    @Test
    void upsertCollaborator_targetIsDocumentOwner_setsTheirLevel() {
        UUID docOwnerId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID bobId = UUID.randomUUID();

        User docOwner = User.builder()
                .id(docOwnerId)
                .email("owner@example.com")
                .passwordHash("$2a$12$hash")
                .build();
        User actor = User.builder().id(actorId).passwordHash("$2a$12$hash").build();
        User bob = User.builder().id(bobId).passwordHash("$2a$12$hash").build();

        Document document = Document.builder().id(documentId).creator(docOwner).build();
        AccessGrant anotherOwner = AccessGrant.builder()
                .document(document)
                .user(bob)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.OWNER)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(document);
        when(userRepository.findByEmail("owner@example.com")).thenReturn(Optional.of(docOwner));
        when(permissionService.resolveAccess(docOwnerId, documentId)).thenReturn(DocumentAccessLevel.OWNER);
        when(permissionService.ownsAncestor(docOwnerId, document)).thenReturn(false);
        when(accessGrantRepository.findPositiveUserGrantsByDocumentId(documentId))
                .thenReturn(List.of(anotherOwner));
        when(permissionService.resolveAccessForUsers(eq(documentId), any(), eq(false)))
                .thenReturn(Map.of(bobId, DocumentAccessLevel.OWNER));
        when(userRepository.findById(actorId)).thenReturn(Optional.of(actor));
        CollaboratorResponse response = sharingService.upsertCollaborator(
                actorId, documentId, new CollaboratorUpsertRequest("owner@example.com", DocumentAccessLevel.EDIT));

        verify(accessGrantSyncService).upsertUserGrant(document, docOwner, DocumentAccessLevel.EDIT, actor);
        assertEquals(DocumentAccessLevel.EDIT, response.accessLevel());
    }

    @Test
    void upsertCollaborator_lastOwnerCannotBeDemoted() {
        UUID ownerId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        User owner = User.builder()
                .id(ownerId)
                .email("owner@example.com")
                .passwordHash("$2a$12$hash")
                .build();
        Document document = Document.builder().id(documentId).creator(owner).build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(document);
        when(userRepository.findByEmail("owner@example.com")).thenReturn(Optional.of(owner));
        when(permissionService.resolveAccess(ownerId, documentId)).thenReturn(DocumentAccessLevel.OWNER);
        when(permissionService.ownsAncestor(ownerId, document)).thenReturn(false);
        when(accessGrantRepository.findPositiveUserGrantsByDocumentId(documentId))
                .thenReturn(List.of());

        ApiException ex = assertThrows(
                ApiException.class,
                () -> sharingService.upsertCollaborator(
                        actorId,
                        documentId,
                        new CollaboratorUpsertRequest("owner@example.com", DocumentAccessLevel.EDIT)));

        assertEquals(ErrorCode.CONFLICT, ex.getErrorCode());
        verify(accessGrantSyncService, never()).upsertUserGrant(any(), any(), any(), any());
    }

    @Test
    void upsertCollaborator_targetIsActor_throwsConflict() {
        UUID docOwnerId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        User docOwner = User.builder()
                .id(docOwnerId)
                .email("owner@example.com")
                .passwordHash("$2a$12$hash")
                .build();

        Document document = Document.builder().id(documentId).creator(docOwner).build();

        User actor = User.builder()
                .id(actorId)
                .email("actor@example.com")
                .passwordHash("$2a$12$hash")
                .build();

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

        User actor = User.builder()
                .id(actorId)
                .email("owner@example.com")
                .passwordHash("$2a$12$hash")
                .build();

        User ancestorOwner = User.builder()
                .id(UUID.randomUUID())
                .email("ancestor@example.com")
                .passwordHash("$2a$12$hash")
                .build();
        Document ancestor = Document.builder()
                .id(ancestorDocId)
                .creator(ancestorOwner)
                .title("Ancestor")
                .build();
        Document document = Document.builder()
                .id(documentId)
                .creator(actor)
                .parent(ancestor)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(document);
        when(userRepository.findByEmail("ancestor@example.com")).thenReturn(Optional.of(ancestorOwner));

        sharingService.upsertCollaborator(
                actorId, documentId, new CollaboratorUpsertRequest("ancestor@example.com", DocumentAccessLevel.VIEW));

        verify(accessGrantSyncService).upsertUserGrant(any(), any(), eq(DocumentAccessLevel.VIEW), any());
    }

    @Test
    void updateCollaboratorAccess_anotherOwnerDemotesTheCreator() {
        UUID docOwnerId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID bobId = UUID.randomUUID();
        User docOwner =
                User.builder().id(docOwnerId).passwordHash("$2a$12$hash").build();
        User actor = User.builder().id(actorId).passwordHash("$2a$12$hash").build();
        User bob = User.builder().id(bobId).passwordHash("$2a$12$hash").build();
        Document document = Document.builder().id(documentId).creator(docOwner).build();
        AccessGrant anotherOwner = AccessGrant.builder()
                .document(document)
                .user(bob)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.OWNER)
                .build();

        AccessGrant creatorOwner = ownerGrant(document, docOwner);
        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(document);
        when(userRepository.findById(actorId)).thenReturn(Optional.of(actor));
        when(accessGrantRepository.hasPositiveIdentityGrant(docOwnerId, documentId))
                .thenReturn(true);
        when(accessGrantRepository.findByDocument_IdAndUser_Id(documentId, docOwnerId))
                .thenReturn(Optional.of(creatorOwner));
        when(permissionService.resolveAccess(docOwnerId, documentId)).thenReturn(DocumentAccessLevel.OWNER);
        when(accessGrantRepository.findPositiveUserGrantsByDocumentId(documentId))
                .thenReturn(List.of(creatorOwner, anotherOwner));
        when(permissionService.resolveAccessForUsers(eq(documentId), any(), eq(false)))
                .thenReturn(Map.of(bobId, DocumentAccessLevel.OWNER));

        sharingService.updateCollaboratorAccess(
                actorId, documentId, docOwnerId, new CollaboratorAccessUpdateRequest(DocumentAccessLevel.VIEW));

        verify(accessGrantSyncService).upsertUserGrant(document, docOwner, DocumentAccessLevel.VIEW, actor);
        var inOrder = Mockito.inOrder(documentRepository, permissionService);
        inOrder.verify(documentRepository).findByIdForOwnershipUpdate(documentId);
        inOrder.verify(permissionService).requireSharingAdminAccess(actorId, documentId);
        assertEquals(1, publishedEvents.size());
        assertEquals(List.of(docOwnerId), ((DocumentAccessChangedEvent) publishedEvents.get(0)).affectedUsers());
    }

    @Test
    void updateCollaboratorAccess_selfDemotion_succeeds() {
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        User actor = User.builder()
                .id(actorId)
                .email("owner@example.com")
                .passwordHash("$2a$12$hash")
                .build();
        Document document = Document.builder()
                .id(documentId)
                .creator(User.builder()
                        .id(UUID.randomUUID())
                        .passwordHash("$2a$12$hash")
                        .build())
                .build();
        AccessGrant existing = AccessGrant.builder()
                .document(document)
                .user(actor)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.OWNER)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(document);
        when(accessGrantRepository.findByDocument_IdAndUser_Id(documentId, actorId))
                .thenReturn(Optional.of(existing));
        when(userRepository.findById(actorId)).thenReturn(Optional.of(actor));
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of());

        sharingService.updateCollaboratorAccess(
                actorId, documentId, actorId, new CollaboratorAccessUpdateRequest(DocumentAccessLevel.EDIT));

        verify(accessGrantSyncService).upsertUserGrant(any(), any(), eq(DocumentAccessLevel.EDIT), any());
        verify(auditService)
                .recordDocument(
                        eq(document),
                        eq(actorId),
                        eq(AccessAuditAction.COLLABORATOR_UPDATE),
                        eq("USER"),
                        eq(actorId),
                        eq("level=" + DocumentAccessLevel.EDIT));
        // The caller's own open socket has to learn it lost owner rights.
        assertEquals(1, publishedEvents.size());
        DocumentAccessChangedEvent event = (DocumentAccessChangedEvent) publishedEvents.get(0);
        assertEquals(List.of(actorId), event.affectedUsers());
    }

    @Test
    void updateCollaboratorAccess_creatorSelfDemotion_succeeds() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID bobId = UUID.randomUUID();
        User creator = User.builder().id(ownerId).passwordHash("$2a$12$hash").build();
        User bob = User.builder().id(bobId).passwordHash("$2a$12$hash").build();
        Document document = Document.builder().id(documentId).creator(creator).build();
        AccessGrant anotherOwner = AccessGrant.builder()
                .document(document)
                .user(bob)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.OWNER)
                .build();

        when(permissionService.requireSharingAdminAccess(ownerId, documentId)).thenReturn(document);
        when(accessGrantRepository.findByDocument_IdAndUser_Id(documentId, ownerId))
                .thenReturn(Optional.of(ownerGrant(document, creator)));
        when(permissionService.resolveAccess(ownerId, documentId)).thenReturn(DocumentAccessLevel.OWNER);
        when(accessGrantRepository.findPositiveUserGrantsByDocumentId(documentId))
                .thenReturn(List.of(ownerGrant(document, creator), anotherOwner));
        when(permissionService.resolveAccessForUsers(eq(documentId), any(), eq(false)))
                .thenReturn(Map.of(bobId, DocumentAccessLevel.OWNER));

        sharingService.updateCollaboratorAccess(
                ownerId, documentId, ownerId, new CollaboratorAccessUpdateRequest(DocumentAccessLevel.EDIT));

        verify(accessGrantSyncService).upsertUserGrant(document, creator, DocumentAccessLevel.EDIT, creator);
        // The demoted creator's page moves to their Shared section.
        verify(sharedSectionService).ensureOrderRow(creator, document);
        assertEquals(1, publishedEvents.size());
        assertEquals(List.of(ownerId), ((DocumentAccessChangedEvent) publishedEvents.get(0)).affectedUsers());
    }

    @Test
    void updateCollaboratorAccess_creatorAsLastOwner_throwsConflict() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = Document.builder()
                .id(documentId)
                .creator(User.builder().id(ownerId).passwordHash("$2a$12$hash").build())
                .build();

        when(permissionService.requireSharingAdminAccess(ownerId, documentId)).thenReturn(document);
        when(permissionService.resolveAccess(ownerId, documentId)).thenReturn(DocumentAccessLevel.OWNER);
        when(accessGrantRepository.findPositiveUserGrantsByDocumentId(documentId))
                .thenReturn(List.of(ownerGrant(document, document.getCreator())));

        ApiException ex = assertThrows(
                ApiException.class,
                () -> sharingService.updateCollaboratorAccess(
                        ownerId, documentId, ownerId, new CollaboratorAccessUpdateRequest(DocumentAccessLevel.EDIT)));
        assertEquals(ErrorCode.CONFLICT, ex.getErrorCode());
        verify(accessGrantSyncService, never()).upsertUserGrant(any(), any(), any(), any());
    }

    @Test
    void updateCollaboratorAccess_creatorBackToOwner_upsertsTheOwnerRow() {
        UUID ownerId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        User creator = User.builder().id(ownerId).passwordHash("$2a$12$hash").build();
        Document document = Document.builder().id(documentId).creator(creator).build();
        AccessGrant override = AccessGrant.builder()
                .document(document)
                .user(creator)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.EDIT)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(document);
        when(userRepository.findById(actorId))
                .thenReturn(Optional.of(
                        User.builder().id(actorId).passwordHash("$2a$12$hash").build()));
        when(accessGrantRepository.findByDocument_IdAndUser_Id(documentId, ownerId))
                .thenReturn(Optional.of(override));

        sharingService.updateCollaboratorAccess(
                actorId, documentId, ownerId, new CollaboratorAccessUpdateRequest(DocumentAccessLevel.OWNER));

        verify(accessGrantSyncService).upsertUserGrant(eq(document), eq(creator), eq(DocumentAccessLevel.OWNER), any());
    }

    @Test
    void updateCollaboratorAccess_lastOwnerOfAnyKindCannotBeDemoted() {
        UUID creatorId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID bobId = UUID.randomUUID();
        User creator = User.builder().id(creatorId).passwordHash("$2a$12$hash").build();
        User bob = User.builder().id(bobId).passwordHash("$2a$12$hash").build();
        Document document = Document.builder().id(documentId).creator(creator).build();
        AccessGrant creatorOverride = AccessGrant.builder()
                .document(document)
                .user(creator)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.EDIT)
                .build();
        AccessGrant bobOwner = AccessGrant.builder()
                .document(document)
                .user(bob)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.OWNER)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(document);
        when(userRepository.findById(actorId))
                .thenReturn(Optional.of(
                        User.builder().id(actorId).passwordHash("$2a$12$hash").build()));
        when(accessGrantRepository.findPositiveUserGrantsByDocumentId(documentId))
                .thenReturn(List.of(creatorOverride, bobOwner));
        when(permissionService.resolveAccess(bobId, documentId)).thenReturn(DocumentAccessLevel.OWNER);

        ApiException ex = assertThrows(
                ApiException.class,
                () -> sharingService.updateCollaboratorAccess(
                        actorId, documentId, bobId, new CollaboratorAccessUpdateRequest(DocumentAccessLevel.VIEW)));
        assertEquals(ErrorCode.CONFLICT, ex.getErrorCode());
    }

    @Test
    void updateCollaboratorAccess_selfNoAccess_throwsConflict() {
        UUID docOwnerId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = Document.builder()
                .id(documentId)
                .creator(User.builder()
                        .id(docOwnerId)
                        .passwordHash("$2a$12$hash")
                        .build())
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(document);

        ApiException ex = assertThrows(
                ApiException.class,
                () -> sharingService.updateCollaboratorAccess(
                        actorId,
                        documentId,
                        actorId,
                        new CollaboratorAccessUpdateRequest(DocumentAccessLevel.NO_ACCESS)));
        assertEquals(ErrorCode.CONFLICT, ex.getErrorCode());
        verify(accessGrantSyncService, never()).upsertUserGrant(any(), any(), any(), any());
    }

    @Test
    void removeCollaborator_ownerWithAnotherOwner_removesTheRow() {
        UUID docOwnerId = UUID.randomUUID();
        UUID bobId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        User docOwner =
                User.builder().id(docOwnerId).passwordHash("$2a$12$hash").build();
        Document document = Document.builder().id(documentId).creator(docOwner).build();
        User bob = User.builder().id(bobId).passwordHash("$2a$12$hash").build();

        UUID workspaceId = UUID.randomUUID();
        when(documentRepository.findWorkspaceIdById(documentId)).thenReturn(Optional.of(workspaceId));
        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(document);
        when(permissionService.resolveAccess(docOwnerId, documentId)).thenReturn(DocumentAccessLevel.OWNER);
        when(accessGrantRepository.findPositiveUserGrantsByDocumentId(documentId))
                .thenReturn(List.of(ownerGrant(document, docOwner), ownerGrant(document, bob)));
        when(permissionService.resolveAccessForUsers(eq(documentId), any(), eq(false)))
                .thenReturn(Map.of(bobId, DocumentAccessLevel.OWNER));
        when(accessGrantRepository.existsByDocument_IdAndUser_Id(documentId, docOwnerId))
                .thenReturn(true);

        sharingService.removeCollaborator(actorId, documentId, docOwnerId);

        var inOrder = Mockito.inOrder(workspaceRepository, documentRepository, permissionService);
        inOrder.verify(workspaceRepository).findByIdForUpdate(workspaceId);
        inOrder.verify(documentRepository).findByIdForOwnershipUpdate(documentId);
        inOrder.verify(permissionService).requireSharingAdminAccess(actorId, documentId);
        verify(accessGrantRepository).deleteByDocument_IdAndUser_Id(documentId, docOwnerId);
    }

    @Test
    void removeCollaborator_targetIsActor_throwsConflict() {
        UUID docOwnerId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = Document.builder()
                .id(documentId)
                .creator(User.builder()
                        .id(docOwnerId)
                        .passwordHash("$2a$12$hash")
                        .build())
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(document);

        ApiException ex =
                assertThrows(ApiException.class, () -> sharingService.removeCollaborator(actorId, documentId, actorId));
        assertEquals(ErrorCode.CONFLICT, ex.getErrorCode());
    }

    @Test
    void listCollaborators_returnsCreatorAndCollaboratorAsGrantRows() {
        UUID ownerId = UUID.randomUUID();
        UUID collabOwnerRoleId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        User docOwner = User.builder()
                .id(ownerId)
                .email("owner@example.com")
                .displayName("Doc Owner")
                .passwordHash("$2a$12$hash")
                .build();
        Document doc = Document.builder()
                .id(documentId)
                .creator(docOwner)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        User collabUser = User.builder()
                .id(collabOwnerRoleId)
                .email("collab@example.com")
                .displayName("Collab Owner")
                .passwordHash("$2a$12$hash")
                .build();
        AccessGrant collaborator = AccessGrant.builder()
                .id(UUID.randomUUID())
                .document(doc)
                .user(collabUser)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.OWNER)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        AccessGrant creatorGrant = ownerGrant(doc, docOwner);
        when(permissionService.requireReadAccessIncludingTrash(ownerId, documentId))
                .thenReturn(doc);
        when(accessGrantRepository.findUserGrantsByDocumentId(documentId))
                .thenReturn(List.of(creatorGrant, collaborator));

        List<CollaboratorResponse> result = sharingService.listCollaborators(ownerId, documentId);

        assertEquals(2, result.size());
        // The creator is an ordinary OWNER row now: no synthetic first entry.
        assertThat(result).extracting(CollaboratorResponse::userId).contains(ownerId, collabOwnerRoleId);
        assertThat(result).allMatch(row -> !row.inherited());
        assertThat(result.get(1).accessLevel()).isEqualTo(DocumentAccessLevel.OWNER);
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
                .passwordHash("$2a$12$hash")
                .build();
        Document doc = Document.builder()
                .id(documentId)
                .creator(docOwner)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        UUID demotedAvatarId = UUID.randomUUID();
        AccessGrant demotedOwner = AccessGrant.builder()
                .id(UUID.randomUUID())
                .document(doc)
                .user(User.builder()
                        .id(demotedOwnerId)
                        .email("demoted@example.com")
                        .displayName("Demoted Owner")
                        .passwordHash("$2a$12$hash")
                        .avatarId(demotedAvatarId)
                        .avatarContentType("image/png")
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
                        .passwordHash("$2a$12$hash")
                        .build())
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.EDIT)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        AccessGrant creatorGrant = ownerGrant(doc, docOwner);
        when(permissionService.requireReadAccessIncludingTrash(ownerId, documentId))
                .thenReturn(doc);
        when(accessGrantRepository.findUserGrantsByDocumentId(documentId))
                .thenReturn(List.of(creatorGrant, demotedOwner, blocked));
        List<CollaboratorResponse> result = sharingService.listCollaborators(ownerId, documentId);

        assertEquals(3, result.size());
        assertEquals(DocumentAccessLevel.OWNER, result.get(1).accessLevel());
        assertEquals(DocumentAccessLevel.EDIT, result.get(2).accessLevel());
        // The roster is grant/provenance only; no per-person effective level is computed.
        assertEquals(
                "/api/v1/users/" + demotedOwnerId + "/avatar?v=" + demotedAvatarId,
                result.get(1).avatarUrl());
    }

    @Test
    void getSharingSettings_andUpdate_forFullAccessCollaborator_succeeds() {
        UUID docOwnerId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = Document.builder()
                .id(documentId)
                .creator(User.builder()
                        .id(docOwnerId)
                        .passwordHash("$2a$12$hash")
                        .build())
                .generalAccessMode(DocumentGeneralAccessMode.RESTRICTED)
                .linkAccessLevel(DocumentAccessLevel.VIEW)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(document);
        when(permissionService.requireReadAccessIncludingTrash(actorId, documentId))
                .thenReturn(document);

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
    void getSharingSettings_requiresRosterVisibility() {
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = Document.builder()
                .id(documentId)
                .generalAccessMode(DocumentGeneralAccessMode.RESTRICTED)
                .linkAccessLevel(DocumentAccessLevel.VIEW)
                .build();
        when(permissionService.requireReadAccessIncludingTrash(actorId, documentId))
                .thenReturn(document);

        settingsService.getSharingSettings(actorId, documentId);

        // Reading is not owner-only, but it is not roster-anonymous either: a link-only
        // outsider gets the same 404 as the collaborator list.
        verify(permissionService).requireRosterAccess(actorId, document);
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
                .passwordHash("$2a$12$hash")
                .build();

        Document parent = Document.builder()
                .id(parentDocId)
                .creator(owner)
                .title("Parent Page")
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        Document child = Document.builder()
                .id(childDocId)
                .creator(owner)
                .parent(parent)
                .title("Child Page")
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        UUID directCollabUserId = UUID.randomUUID();
        User directCollabUser = User.builder()
                .id(directCollabUserId)
                .email("direct@example.com")
                .displayName("Direct Collab")
                .passwordHash("$2a$12$hash")
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
                .passwordHash("$2a$12$hash")
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
        stubAncestorChain(child, List.of(parent), List.of(ownerGrant(parent, owner), parentCollab));

        List<CollaboratorResponse> result = sharingService.listCollaborators(ownerId, childDocId);

        assertEquals(3, result.size());

        // 1. Direct collaborator on child
        CollaboratorResponse directResp = result.get(0);
        assertEquals(directCollabUserId, directResp.userId());
        assertFalse(directResp.inherited());
        assertNull(directResp.inheritedFromId());

        // 2. Root owner and parent collaborator are inherited.
        CollaboratorResponse ownerResp = result.get(1);
        assertEquals(ownerId, ownerResp.userId());
        assertTrue(ownerResp.inherited());
        assertEquals(parentDocId, ownerResp.inheritedFromId());
        CollaboratorResponse inheritedResp = result.get(2);
        assertEquals(parentCollabUserId, inheritedResp.userId());
        assertTrue(inheritedResp.inherited());
        assertEquals(parentDocId, inheritedResp.inheritedFromId());
        assertEquals("Parent Page", inheritedResp.inheritedFromTitle());
    }

    @Test
    void getSharingSettings_withAncestorPublicLink_returnsInheritedSettings() {
        UUID actorId = UUID.randomUUID();
        UUID childDocId = UUID.randomUUID();
        UUID parentDocId = UUID.randomUUID();

        User owner = User.builder().id(actorId).passwordHash("$2a$12$hash").build();

        Document parent = Document.builder()
                .id(parentDocId)
                .creator(owner)
                .title("Parent Wiki")
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.VIEW)
                .build();

        Document child = Document.builder()
                .id(childDocId)
                .creator(owner)
                .parent(parent)
                .generalAccessMode(DocumentGeneralAccessMode.RESTRICTED)
                .build();

        when(permissionService.requireReadAccessIncludingTrash(actorId, childDocId))
                .thenReturn(child);
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

        User owner = User.builder().id(actorId).passwordHash("$2a$12$hash").build();

        Document parent = Document.builder()
                .id(parentDocId)
                .creator(owner)
                .title("Parent Wiki")
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.VIEW)
                .build();

        Document child = Document.builder()
                .id(childDocId)
                .creator(owner)
                .parent(parent)
                .generalAccessMode(DocumentGeneralAccessMode.RESTRICTED)
                // Stale level from a time when the child itself was public; it must not win.
                .linkAccessLevel(DocumentAccessLevel.EDIT)
                .build();

        when(permissionService.requireReadAccessIncludingTrash(actorId, childDocId))
                .thenReturn(child);
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

        User owner = User.builder().id(actorId).passwordHash("$2a$12$hash").build();

        Document grandparent = Document.builder()
                .id(grandparentDocId)
                .creator(owner)
                .title("Grandparent Wiki")
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.EDIT)
                .build();

        Document trashedParent = Document.builder()
                .id(trashedParentDocId)
                .creator(owner)
                .title("Trashed Parent")
                .parent(grandparent)
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.VIEW)
                .build();

        Document child = Document.builder()
                .id(childDocId)
                .creator(owner)
                .parent(trashedParent)
                .generalAccessMode(DocumentGeneralAccessMode.RESTRICTED)
                .linkAccessLevel(DocumentAccessLevel.COMMENT)
                .build();

        when(permissionService.requireReadAccessIncludingTrash(actorId, childDocId))
                .thenReturn(child);
        // The chain reports the trashed parent and the live grandparent, but resolution
        // stops at the trash boundary so the grandparent's link grant never applies.
        when(documentRepository.findAncestorChainIds(childDocId))
                .thenReturn(List.of(trashedParentDocId, grandparentDocId));
        when(documentRepository.findAllForChainByIdIn(List.of(trashedParentDocId, grandparentDocId)))
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

        User owner = User.builder().id(actorId).passwordHash("$2a$12$hash").build();

        Document parent = Document.builder()
                .id(parentDocId)
                .creator(owner)
                .title("Parent Wiki")
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.VIEW)
                .build();

        Document child = Document.builder()
                .id(childDocId)
                .creator(owner)
                .parent(parent)
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.EDIT)
                .build();

        when(permissionService.requireReadAccessIncludingTrash(actorId, childDocId))
                .thenReturn(child);
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

        User owner = User.builder().id(actorId).passwordHash("$2a$12$hash").build();

        Document grandparent = Document.builder()
                .id(grandparentDocId)
                .creator(owner)
                .title("Grandparent Wiki")
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.EDIT)
                .build();

        Document parent = Document.builder()
                .id(parentDocId)
                .creator(owner)
                .parent(grandparent)
                .title("Blocked Parent")
                .generalAccessMode(DocumentGeneralAccessMode.RESTRICTED)
                .linkInheritBlocked(true)
                .build();

        Document child = Document.builder()
                .id(childDocId)
                .creator(owner)
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

        User owner = User.builder().id(actorId).passwordHash("$2a$12$hash").build();

        Document parent = Document.builder()
                .id(parentDocId)
                .creator(owner)
                .title("Parent Wiki")
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.EDIT)
                .build();

        Document child = Document.builder()
                .id(childDocId)
                .creator(owner)
                .parent(parent)
                .generalAccessMode(DocumentGeneralAccessMode.RESTRICTED)
                .linkInheritBlocked(true)
                .build();

        when(permissionService.requireReadAccessIncludingTrash(actorId, childDocId))
                .thenReturn(child);
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

        User owner = User.builder().id(actorId).passwordHash("$2a$12$hash").build();

        Document grandparent = Document.builder()
                .id(grandparentDocId)
                .creator(owner)
                .title("Grandparent Wiki")
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.EDIT)
                .build();

        Document blockedParent = Document.builder()
                .id(blockedParentDocId)
                .creator(owner)
                .title("Blocked Parent")
                .parent(grandparent)
                .generalAccessMode(DocumentGeneralAccessMode.RESTRICTED)
                .linkInheritBlocked(true)
                .build();

        Document child = Document.builder()
                .id(childDocId)
                .creator(owner)
                .parent(blockedParent)
                .generalAccessMode(DocumentGeneralAccessMode.RESTRICTED)
                .build();

        when(permissionService.requireReadAccessIncludingTrash(actorId, childDocId))
                .thenReturn(child);
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

        User owner = User.builder().id(actorId).passwordHash("$2a$12$hash").build();

        Document parent = Document.builder()
                .id(parentDocId)
                .creator(owner)
                .title("Parent Wiki")
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.VIEW)
                .build();

        Document child = Document.builder()
                .id(childDocId)
                .creator(owner)
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

        User owner = User.builder().id(actorId).passwordHash("$2a$12$hash").build();

        Document doc = Document.builder()
                .id(documentId)
                .creator(owner)
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

        User owner = User.builder().id(actorId).passwordHash("$2a$12$hash").build();
        Document doc = Document.builder()
                .id(documentId)
                .creator(owner)
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

        User owner = User.builder().id(actorId).passwordHash("$2a$12$hash").build();
        Document doc = Document.builder()
                .id(documentId)
                .creator(owner)
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

        User owner = User.builder().id(actorId).passwordHash("$2a$12$hash").build();
        Document doc = Document.builder()
                .id(documentId)
                .creator(owner)
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

        User owner = User.builder().id(actorId).passwordHash("$2a$12$hash").build();

        Document parent = Document.builder()
                .id(parentDocId)
                .creator(owner)
                .title("Private Parent")
                .generalAccessMode(DocumentGeneralAccessMode.RESTRICTED)
                .build();

        Document child = Document.builder()
                .id(childDocId)
                .creator(owner)
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

        User owner = User.builder().id(actorId).passwordHash("$2a$12$hash").build();
        Document parent = Document.builder()
                .id(parentDocId)
                .creator(owner)
                .title("Parent Wiki")
                .workspaceAccessMode(DocumentWorkspaceAccessMode.WORKSPACE_MEMBERS)
                .workspaceAccessLevel(DocumentAccessLevel.EDIT)
                .build();
        Document child = Document.builder()
                .id(childDocId)
                .creator(owner)
                .parent(parent)
                .workspaceAccessMode(DocumentWorkspaceAccessMode.RESTRICTED)
                .build();

        when(permissionService.requireReadAccessIncludingTrash(actorId, childDocId))
                .thenReturn(child);
        stubAncestorChain(child, List.of(parent), List.of());

        SharingSettingsResponse response = settingsService.getSharingSettings(actorId, childDocId);

        assertTrue(response.workspaceInherited());
        assertEquals(DocumentAccessLevel.EDIT, response.workspaceAccessLevel());
        assertEquals(parentDocId, response.workspaceInheritedFromId());
        assertEquals(SharingSourceKind.PAGE, response.workspaceInheritedFromKind());
        assertEquals("Parent Wiki", response.workspaceInheritedFromTitle());
        assertFalse(response.workspaceInheritBlocked());
    }

    @Test
    void getSharingSettings_withAPublicSpace_reportsTheSpaceAsTheWorkspaceSource() {
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Space space = Space.builder()
                .id(UUID.randomUUID())
                .name("Engineering")
                .accessMode(SpaceAccessMode.PUBLIC)
                .everyoneAccessLevel(DocumentAccessLevel.COMMENT)
                .build();
        Document doc = Document.builder()
                .id(documentId)
                .creator(User.builder().id(actorId).passwordHash("$2a$12$hash").build())
                .space(space)
                .build();

        when(permissionService.requireReadAccessIncludingTrash(actorId, documentId))
                .thenReturn(doc);
        when(spaceAccessService.visibleSpaceIds(actorId, List.of(space))).thenReturn(java.util.Set.of(space.getId()));

        SharingSettingsResponse response = settingsService.getSharingSettings(actorId, documentId);

        // A space audience is inherited like an ancestor page's, and the panel has to know
        // which kind it points at: a space opens its settings, a page opens the editor.
        assertTrue(response.workspaceInherited());
        assertEquals(SharingSourceKind.SPACE, response.workspaceInheritedFromKind());
        assertEquals(space.getId(), response.workspaceInheritedFromId());
        assertEquals("Engineering", response.workspaceInheritedFromTitle());
        assertEquals(DocumentAccessLevel.COMMENT, response.workspaceAccessLevel());
    }

    @Test
    void getSharingSettings_withAPublicSpaceTheCallerCannotFind_hidesTheSource() {
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Space space = Space.builder()
                .id(UUID.randomUUID())
                .name("Hidden space")
                .accessMode(SpaceAccessMode.PUBLIC)
                .everyoneAccessLevel(DocumentAccessLevel.VIEW)
                .build();
        Document doc = Document.builder()
                .id(documentId)
                .creator(User.builder().id(actorId).passwordHash("$2a$12$hash").build())
                .space(space)
                .build();

        when(permissionService.requireReadAccessIncludingTrash(actorId, documentId))
                .thenReturn(doc);
        when(spaceAccessService.visibleSpaceIds(actorId, List.of(space))).thenReturn(java.util.Set.of());

        SharingSettingsResponse response = settingsService.getSharingSettings(actorId, documentId);

        assertTrue(response.workspaceInherited());
        assertNull(response.workspaceInheritedFromKind());
        assertNull(response.workspaceInheritedFromId());
        assertNull(response.workspaceInheritedFromTitle());
        assertEquals(DocumentAccessLevel.VIEW, response.workspaceAccessLevel());
    }

    @Test
    void updateSharingSettings_blockOnAPublicSpacePage_isKept() {
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Space space = Space.builder()
                .id(UUID.randomUUID())
                .name("Engineering")
                .accessMode(SpaceAccessMode.PUBLIC)
                .everyoneAccessLevel(DocumentAccessLevel.EDIT)
                .build();
        Document doc = Document.builder()
                .id(documentId)
                .creator(User.builder().id(actorId).passwordHash("$2a$12$hash").build())
                .workspaceAccessMode(DocumentWorkspaceAccessMode.WORKSPACE_MEMBERS)
                .workspaceAccessLevel(DocumentAccessLevel.EDIT)
                .space(space)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(doc);
        when(documentRepository.save(doc)).thenReturn(doc);
        when(spaceAccessService.visibleSpaceIds(actorId, List.of(space))).thenReturn(java.util.Set.of(space.getId()));

        SharingSettingsResponse response = settingsService.updateSharingSettings(
                actorId,
                documentId,
                new SharingSettingsUpdateRequest(
                        null, null, null, DocumentWorkspaceAccessMode.RESTRICTED, null, true, null, null));

        // The space supplies the audience, so the block shadows a real grant and sticks.
        assertTrue(response.workspaceInheritBlocked());
        assertTrue(doc.isWorkspaceInheritBlocked());
        assertEquals(DocumentWorkspaceAccessMode.RESTRICTED, doc.getWorkspaceAccessMode());
    }

    @Test
    void updateSharingSettings_enablesWorkspaceAccessAndClearsBlock() {
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        Document doc = Document.builder()
                .id(documentId)
                .creator(User.builder().id(actorId).passwordHash("$2a$12$hash").build())
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

        User owner = User.builder().id(actorId).passwordHash("$2a$12$hash").build();
        Document parent = Document.builder()
                .id(parentDocId)
                .creator(owner)
                .title("Parent Wiki")
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.VIEW)
                .build();
        Document child = Document.builder()
                .id(childDocId)
                .creator(owner)
                .parent(parent)
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.EDIT)
                .linkExpiresAt(OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(1))
                .build();

        when(permissionService.requireReadAccessIncludingTrash(actorId, childDocId))
                .thenReturn(child);
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

        User owner = User.builder()
                .id(ownerId)
                .email("owner@example.com")
                .passwordHash("$2a$12$hash")
                .build();

        Document parent = Document.builder()
                .id(parentDocId)
                .creator(owner)
                .title("Parent Doc")
                .build();
        Document child = Document.builder()
                .id(childDocId)
                .creator(owner)
                .parent(parent)
                .title("Child Doc")
                .build();

        UUID bobId = UUID.randomUUID();

        User bob = User.builder()
                .id(bobId)
                .email("bob@example.com")
                .passwordHash("$2a$12$hash")
                .build();

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
        stubAncestorChain(child, List.of(parent), List.of(ownerGrant(parent, owner), parentCollab));

        List<CollaboratorResponse> result = sharingService.listCollaborators(ownerId, childDocId);

        assertEquals(2, result.size());
        CollaboratorResponse bobResp = result.stream()
                .filter(row -> row.userId().equals(bobId))
                .findFirst()
                .orElseThrow();
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

        User owner = User.builder()
                .id(ownerId)
                .email("owner@example.com")
                .passwordHash("$2a$12$hash")
                .build();

        Document grandparent = Document.builder()
                .id(grandparentDocId)
                .creator(owner)
                .title("Grandparent")
                .build();
        Document parent = Document.builder()
                .id(parentDocId)
                .creator(owner)
                .parent(grandparent)
                .title("Parent")
                .build();
        Document child = Document.builder()
                .id(childDocId)
                .creator(owner)
                .parent(parent)
                .title("Child")
                .build();

        UUID bobId = UUID.randomUUID();

        User bob = User.builder()
                .id(bobId)
                .email("bob@example.com")
                .passwordHash("$2a$12$hash")
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
        when(accessGrantRepository.findUserGrantsByDocumentId(childDocId)).thenReturn(List.of());
        stubAncestorChain(
                child,
                List.of(parent, grandparent),
                List.of(ownerGrant(grandparent, owner), parentNoAccess, grandparentEdit));

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

        User owner = User.builder()
                .id(ownerId)
                .email("owner@example.com")
                .passwordHash("$2a$12$hash")
                .build();

        Document grandparent = Document.builder()
                .id(grandparentDocId)
                .creator(owner)
                .title("Grandparent")
                .build();
        Document parent = Document.builder()
                .id(parentDocId)
                .creator(owner)
                .parent(grandparent)
                .title("Parent")
                .build();
        Document child = Document.builder()
                .id(childDocId)
                .creator(owner)
                .parent(parent)
                .title("Child")
                .build();

        UUID bobId = UUID.randomUUID();

        User bob = User.builder()
                .id(bobId)
                .email("bob@example.com")
                .passwordHash("$2a$12$hash")
                .build();

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
        stubAncestorChain(
                child,
                List.of(parent, grandparent),
                List.of(ownerGrant(grandparent, owner), parentNoAccess, grandparentEdit));

        List<CollaboratorResponse> result = sharingService.listCollaborators(ownerId, childDocId);

        assertEquals(2, result.size());
        CollaboratorResponse bobResp = result.stream()
                .filter(row -> row.userId().equals(bobId))
                .findFirst()
                .orElseThrow();
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
                .creator(User.builder().id(ownerId).passwordHash("$2a$12$hash").build())
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

        User owner = User.builder().id(ownerId).passwordHash("$2a$12$hash").build();

        User bob = User.builder().id(bobId).passwordHash("$2a$12$hash").build();
        Document document = Document.builder().id(documentId).creator(owner).build();
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

        User owner = User.builder().id(ownerId).passwordHash("$2a$12$hash").build();

        User bob = User.builder().id(bobId).passwordHash("$2a$12$hash").build();
        Document document = Document.builder().id(documentId).creator(owner).build();
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

        User owner = User.builder().id(ownerId).passwordHash("$2a$12$hash").build();

        User bob = User.builder().id(bobId).passwordHash("$2a$12$hash").build();
        Document document = Document.builder().id(documentId).creator(owner).build();

        when(permissionService.requireSharingAdminAccess(ownerId, documentId)).thenReturn(document);
        when(accessGrantRepository.existsByDocument_IdAndUser_Id(documentId, bobId))
                .thenReturn(true);
        when(userRepository.findById(bobId)).thenReturn(Optional.of(bob));
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of());

        sharingService.removeCollaborator(ownerId, documentId, bobId);

        verify(accessGrantRepository).deleteByDocument_IdAndUser_Id(documentId, bobId);
        verify(userSharedOrderRepository).deleteByUser_IdAndDocument_Id(bobId, documentId);
    }

    @Test
    void updateCollaboratorAccess_ancestorFullAccessUser_createsOverrideRow() {
        UUID actorId = UUID.randomUUID();
        UUID ancestorOwnerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID parentDocId = UUID.randomUUID();

        User ancestorOwner =
                User.builder().id(ancestorOwnerId).passwordHash("$2a$12$hash").build();
        Document parent =
                Document.builder().id(parentDocId).creator(ancestorOwner).build();
        Document child = Document.builder()
                .id(documentId)
                .creator(User.builder().id(actorId).passwordHash("$2a$12$hash").build())
                .parent(parent)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(child);
        when(accessGrantRepository.hasPositiveIdentityGrant(ancestorOwnerId, documentId))
                .thenReturn(true);
        when(accessGrantRepository.findByDocument_IdAndUser_Id(documentId, ancestorOwnerId))
                .thenReturn(Optional.empty());
        when(userRepository.findById(ancestorOwnerId)).thenReturn(Optional.of(ancestorOwner));
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

        User owner = User.builder().id(actorId).passwordHash("$2a$12$hash").build();
        Document document = Document.builder()
                .id(documentId)
                .creator(owner)
                .workspaceAccessMode(DocumentWorkspaceAccessMode.WORKSPACE_MEMBERS)
                .workspaceAccessLevel(DocumentAccessLevel.VIEW)
                .build();

        User member = User.builder().id(memberId).passwordHash("$2a$12$hash").build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(document);
        when(accessGrantRepository.findByDocument_IdAndUser_Id(documentId, memberId))
                .thenReturn(Optional.empty());
        when(accessGrantRepository.hasPositiveIdentityGrant(memberId, documentId))
                .thenReturn(true);
        when(userRepository.findById(memberId)).thenReturn(Optional.of(member));
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of());

        sharingService.updateCollaboratorAccess(
                actorId, documentId, memberId, new CollaboratorAccessUpdateRequest(DocumentAccessLevel.NO_ACCESS));

        verify(accessGrantSyncService)
                .upsertUserGrant(eq(document), eq(member), eq(DocumentAccessLevel.NO_ACCESS), eq(owner));
    }

    @Test
    void updateCollaboratorAccess_spaceOwner_withNoAccess_throwsConflict() {
        UUID actorId = UUID.randomUUID();
        UUID spaceOwnerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID spaceId = UUID.randomUUID();

        Space space = Space.builder().id(spaceId).name("Engineering").build();
        User actor = User.builder().id(actorId).passwordHash("$2a$12$hash").build();
        User spaceOwner =
                User.builder().id(spaceOwnerId).passwordHash("$2a$12$hash").build();
        Document document =
                Document.builder().id(documentId).creator(actor).space(space).build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(document);
        when(permissionService.resolveSpace(document)).thenReturn(space);
        when(spaceMemberRepository.findBySpace_IdAndUser_Id(spaceId, spaceOwnerId))
                .thenReturn(Optional.of(SpaceMember.builder()
                        .id(UUID.randomUUID())
                        .space(space)
                        .user(spaceOwner)
                        .accessLevel(DocumentAccessLevel.OWNER)
                        .build()));

        ApiException exception = assertThrows(
                ApiException.class,
                () -> sharingService.updateCollaboratorAccess(
                        actorId,
                        documentId,
                        spaceOwnerId,
                        new CollaboratorAccessUpdateRequest(DocumentAccessLevel.NO_ACCESS)));

        assertEquals(ErrorCode.CONFLICT, exception.getErrorCode());
        assertEquals("An inherited owner cannot be set to No access on this page.", exception.getMessage());
        verify(accessGrantSyncService, never()).upsertUserGrant(any(), any(), any(), any());
    }

    @Test
    void updateCollaboratorAccess_demotedAncestorOwner_canRestoreOwnOwnerLevel() {
        UUID actorId = UUID.randomUUID();
        UUID creatorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID parentId = UUID.randomUUID();

        User actor = User.builder().id(actorId).passwordHash("$2a$12$hash").build();
        User creator = User.builder().id(creatorId).passwordHash("$2a$12$hash").build();
        Document parent = Document.builder().id(parentId).creator(creator).build();
        Document child = Document.builder()
                .id(documentId)
                .creator(creator)
                .parent(parent)
                .build();
        AccessGrant currentEdit = AccessGrant.builder()
                .document(child)
                .user(actor)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.EDIT)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(child);
        when(permissionService.resolveSpace(child)).thenReturn(null);
        when(accessGrantRepository.hasPositiveIdentityGrant(actorId, documentId))
                .thenReturn(true);
        when(accessGrantRepository.findByDocument_IdAndUser_Id(documentId, actorId))
                .thenReturn(Optional.of(currentEdit));
        when(userRepository.findById(actorId)).thenReturn(Optional.of(actor));
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of());

        sharingService.updateCollaboratorAccess(
                actorId, documentId, actorId, new CollaboratorAccessUpdateRequest(DocumentAccessLevel.OWNER));

        verify(accessGrantSyncService).upsertUserGrant(eq(child), eq(actor), eq(DocumentAccessLevel.OWNER), eq(actor));
    }

    @Test
    void updateCollaboratorAccess_ancestorOwnerSelfDemotionWithoutOtherPageOwner_succeeds() {
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID parentId = UUID.randomUUID();

        User actor = User.builder().id(actorId).passwordHash("$2a$12$hash").build();
        Document parent = Document.builder().id(parentId).creator(actor).build();
        Document child =
                Document.builder().id(documentId).creator(actor).parent(parent).build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(child);
        when(permissionService.resolveSpace(child)).thenReturn(null);
        when(permissionService.resolveAccess(actorId, documentId)).thenReturn(DocumentAccessLevel.OWNER);
        // No other page owner exists; only the ancestor-owner exception allows the
        // demotion, so removing that exception must fail this test.
        when(permissionService.ownsAncestor(actorId, child)).thenReturn(true);
        when(accessGrantRepository.hasPositiveIdentityGrant(actorId, documentId))
                .thenReturn(true);
        when(accessGrantRepository.findByDocument_IdAndUser_Id(documentId, actorId))
                .thenReturn(Optional.empty());
        when(userRepository.findById(actorId)).thenReturn(Optional.of(actor));
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of());

        sharingService.updateCollaboratorAccess(
                actorId, documentId, actorId, new CollaboratorAccessUpdateRequest(DocumentAccessLevel.EDIT));

        verify(accessGrantSyncService).upsertUserGrant(eq(child), eq(actor), eq(DocumentAccessLevel.EDIT), eq(actor));
    }

    @Test
    void updateCollaboratorAccess_ancestorOwner_withNoAccess_throwsConflict() {
        UUID actorId = UUID.randomUUID();
        UUID ancestorOwnerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID parentId = UUID.randomUUID();

        User actor = User.builder().id(actorId).passwordHash("$2a$12$hash").build();
        User ancestorOwner =
                User.builder().id(ancestorOwnerId).passwordHash("$2a$12$hash").build();
        Document parent = Document.builder()
                .id(parentId)
                .creator(ancestorOwner)
                .title("Parent Wiki")
                .build();
        Document child =
                Document.builder().id(documentId).creator(actor).parent(parent).build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(child);
        when(permissionService.resolveSpace(child)).thenReturn(null);
        when(permissionService.ownsAncestor(ancestorOwnerId, child)).thenReturn(true);

        ApiException exception = assertThrows(
                ApiException.class,
                () -> sharingService.updateCollaboratorAccess(
                        actorId,
                        documentId,
                        ancestorOwnerId,
                        new CollaboratorAccessUpdateRequest(DocumentAccessLevel.NO_ACCESS)));

        assertEquals(ErrorCode.CONFLICT, exception.getErrorCode());
        assertEquals("An inherited owner cannot be set to No access on this page.", exception.getMessage());
        verify(accessGrantSyncService, never()).upsertUserGrant(any(), any(), any(), any());
    }

    @Test
    void updateCollaboratorAccess_workspaceOwnerOnSpacePage_withNoAccess_throwsConflict() {
        UUID actorId = UUID.randomUUID();
        UUID workspaceOwnerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        User actor = User.builder().id(actorId).passwordHash("$2a$12$hash").build();
        User workspaceOwner =
                User.builder().id(workspaceOwnerId).passwordHash("$2a$12$hash").build();
        Space space = Space.builder().id(UUID.randomUUID()).name("Acme").build();
        Document document =
                Document.builder().id(documentId).creator(actor).space(space).build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(document);
        when(permissionService.resolveSpace(document)).thenReturn(space);
        when(permissionService.isWorkspaceOwner(workspaceOwnerId, document)).thenReturn(true);

        ApiException exception = assertThrows(
                ApiException.class,
                () -> sharingService.updateCollaboratorAccess(
                        actorId,
                        documentId,
                        workspaceOwnerId,
                        new CollaboratorAccessUpdateRequest(DocumentAccessLevel.NO_ACCESS)));

        assertEquals(ErrorCode.CONFLICT, exception.getErrorCode());
        assertEquals("A workspace owner cannot be set to No access on this page.", exception.getMessage());
        verify(accessGrantSyncService, never()).upsertUserGrant(any(), any(), any(), any());
    }

    @Test
    void updateCollaboratorAccess_workspaceOwnerOnPrivatePage_canBeBlocked() {
        UUID actorId = UUID.randomUUID();
        UUID workspaceOwnerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        User actor = User.builder().id(actorId).passwordHash("$2a$12$hash").build();
        User workspaceOwner =
                User.builder().id(workspaceOwnerId).passwordHash("$2a$12$hash").build();
        Document document = Document.builder()
                .id(documentId)
                .creator(actor)
                .workspace(
                        Workspace.builder().id(UUID.randomUUID()).name("Acme").build())
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(document);
        when(permissionService.resolveSpace(document)).thenReturn(null);
        when(accessGrantRepository.hasPositiveIdentityGrant(workspaceOwnerId, documentId))
                .thenReturn(true);
        when(accessGrantRepository.findByDocument_IdAndUser_Id(documentId, workspaceOwnerId))
                .thenReturn(Optional.empty());
        when(userRepository.findById(workspaceOwnerId)).thenReturn(Optional.of(workspaceOwner));

        sharingService.updateCollaboratorAccess(
                actorId,
                documentId,
                workspaceOwnerId,
                new CollaboratorAccessUpdateRequest(DocumentAccessLevel.NO_ACCESS));

        verify(permissionService, never()).isWorkspaceOwner(workspaceOwnerId, document);
        verify(accessGrantSyncService).upsertUserGrant(document, workspaceOwner, DocumentAccessLevel.NO_ACCESS, actor);
        verify(userSharedOrderRepository).deleteByUser_IdAndDocument_Id(workspaceOwnerId, documentId);
    }

    @Test
    void updateCollaboratorAccess_inheritedViewer_withNoAccess_stillPersists() {
        UUID actorId = UUID.randomUUID();
        UUID viewerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID parentId = UUID.randomUUID();

        User actor = User.builder().id(actorId).passwordHash("$2a$12$hash").build();
        User viewer = User.builder().id(viewerId).passwordHash("$2a$12$hash").build();
        Document parent = Document.builder()
                .id(parentId)
                .creator(User.builder()
                        .id(UUID.randomUUID())
                        .passwordHash("$2a$12$hash")
                        .build())
                .title("Parent Wiki")
                .build();
        Document child =
                Document.builder().id(documentId).creator(actor).parent(parent).build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(child);
        when(permissionService.resolveSpace(child)).thenReturn(null);
        when(permissionService.resolveAccess(viewerId, documentId)).thenReturn(DocumentAccessLevel.VIEW);
        when(accessGrantRepository.findByDocument_IdAndUser_Id(documentId, viewerId))
                .thenReturn(Optional.empty());
        when(accessGrantRepository.hasPositiveIdentityGrant(viewerId, documentId))
                .thenReturn(true);
        when(userRepository.findById(viewerId)).thenReturn(Optional.of(viewer));
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of());

        sharingService.updateCollaboratorAccess(
                actorId, documentId, viewerId, new CollaboratorAccessUpdateRequest(DocumentAccessLevel.NO_ACCESS));

        verify(accessGrantSyncService)
                .upsertUserGrant(eq(child), eq(viewer), eq(DocumentAccessLevel.NO_ACCESS), eq(actor));
    }

    @Test
    void updateCollaboratorAccess_withNoAccess_andAncestorGrant_persistsNoAccessRow() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID bobId = UUID.randomUUID();

        User owner = User.builder().id(ownerId).passwordHash("$2a$12$hash").build();
        Document doc = Document.builder().id(documentId).creator(owner).build();

        User bob = User.builder().id(bobId).passwordHash("$2a$12$hash").build();

        when(permissionService.requireSharingAdminAccess(ownerId, documentId)).thenReturn(doc);
        when(accessGrantRepository.hasPositiveIdentityGrant(bobId, documentId)).thenReturn(true);
        when(accessGrantRepository.findByDocument_IdAndUser_Id(documentId, bobId))
                .thenReturn(Optional.empty());
        when(userRepository.findById(bobId)).thenReturn(Optional.of(bob));
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of());

        sharingService.updateCollaboratorAccess(
                ownerId, documentId, bobId, new CollaboratorAccessUpdateRequest(DocumentAccessLevel.NO_ACCESS));

        verify(accessGrantSyncService).upsertUserGrant(any(), any(), eq(DocumentAccessLevel.NO_ACCESS), any());
        verify(userSharedOrderRepository).deleteByUser_IdAndDocument_Id(bobId, documentId);
        verify(accessGrantRepository).pruneOrphanedBreakpoints(documentId);
    }

    @Test
    void updateCollaboratorAccess_withNoAccess_andNoAncestorGrant_deletesRowAndOrder() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID bobId = UUID.randomUUID();

        User owner = User.builder().id(ownerId).passwordHash("$2a$12$hash").build();
        Document doc = Document.builder().id(documentId).creator(owner).build();

        User bob = User.builder().id(bobId).passwordHash("$2a$12$hash").build();
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
        verify(userSharedOrderRepository).deleteByUser_IdAndDocument_Id(bobId, documentId);
        verify(accessGrantRepository).pruneOrphanedBreakpoints(documentId);
    }

    @Test
    void updateCollaboratorAccess_withNoAccess_andLinkOnlyGrant_deletesRowWithoutStoringBreakpoint() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID bobId = UUID.randomUUID();

        User owner = User.builder().id(ownerId).passwordHash("$2a$12$hash").build();
        Document doc = Document.builder()
                .id(documentId)
                .creator(owner)
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.VIEW)
                .build();

        User bob = User.builder().id(bobId).passwordHash("$2a$12$hash").build();
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
        verify(userSharedOrderRepository).deleteByUser_IdAndDocument_Id(bobId, documentId);

        verify(accessGrantRepository).pruneOrphanedBreakpoints(documentId);
    }

    @Test
    void removeCollaborator_withInheritedOnlyUser_throwsNotFound() {
        UUID actorId = UUID.randomUUID();
        UUID ancestorOwnerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID parentDocId = UUID.randomUUID();

        User ancestorOwner =
                User.builder().id(ancestorOwnerId).passwordHash("$2a$12$hash").build();
        Document parent =
                Document.builder().id(parentDocId).creator(ancestorOwner).build();
        Document child = Document.builder()
                .id(documentId)
                .creator(User.builder().id(actorId).passwordHash("$2a$12$hash").build())
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

        User ancestorOwner =
                User.builder().id(ancestorOwnerId).passwordHash("$2a$12$hash").build();
        Document parent =
                Document.builder().id(parentDocId).creator(ancestorOwner).build();
        Document child = Document.builder()
                .id(documentId)
                .creator(User.builder().id(actorId).passwordHash("$2a$12$hash").build())
                .parent(parent)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(child);
        when(accessGrantRepository.existsByDocument_IdAndUser_Id(documentId, ancestorOwnerId))
                .thenReturn(true);
        when(userRepository.findById(ancestorOwnerId)).thenReturn(Optional.of(ancestorOwner));
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of());

        sharingService.removeCollaborator(actorId, documentId, ancestorOwnerId);

        verify(accessGrantRepository).deleteByDocument_IdAndUser_Id(documentId, ancestorOwnerId);
        verify(userSharedOrderRepository).deleteByUser_IdAndDocument_Id(ancestorOwnerId, documentId);
        verify(accessGrantRepository).pruneOrphanedBreakpoints(documentId);
    }

    @Test
    void leaveSharedDocument_prunesBreakpointsAndReconcilesOrderRows() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID ownerId = UUID.randomUUID();

        User user = User.builder().id(userId).passwordHash("$2a$12$hash").build();
        Document document = Document.builder()
                .id(documentId)
                .creator(User.builder().id(ownerId).passwordHash("$2a$12$hash").build())
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
        verify(userSharedOrderRepository).deleteByUser_IdAndDocument_Id(userId, documentId);
        verify(accessGrantRepository).pruneOrphanedBreakpoints(documentId);
    }

    @Test
    void leaveSharedDocument_denyWithLiveLinkCannotRemoveAdminRevocation() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID ownerId = UUID.randomUUID();
        Document document = Document.builder()
                .id(documentId)
                .creator(User.builder().id(ownerId).passwordHash("$2a$12$hash").build())
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

        User user = User.builder().id(userId).passwordHash("$2a$12$hash").build();
        Document document = Document.builder()
                .id(documentId)
                .creator(User.builder().id(ownerId).passwordHash("$2a$12$hash").build())
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
        when(documentRepository.findAllForChainByIdIn(any())).thenReturn(List.of(document));
        when(permissionService.resolveIdentityAccessBatch(eq(userId), any())).thenReturn(identityAccess);

        sharingService.leaveSharedDocument(userId, documentId);

        verify(permissionService).resolveIdentityAccessBatch(eq(userId), any());
        verify(permissionService, never()).resolveAccessBatch(eq(userId), any());
        verify(userSharedOrderRepository, times(2)).deleteByUser_IdAndDocument_Id(userId, documentId);
        verify(userSharedOrderRepository, never()).findMinOrderKeyByUserId(userId, documentId);
    }

    @Test
    void listCollaborators_stopsAtTrashedAncestor() {
        UUID ownerId = UUID.randomUUID();
        UUID childDocId = UUID.randomUUID();
        UUID trashedParentId = UUID.randomUUID();
        UUID grandparentDocId = UUID.randomUUID();

        User owner = User.builder()
                .id(ownerId)
                .email("owner@example.com")
                .passwordHash("$2a$12$hash")
                .build();

        Document grandparent = Document.builder()
                .id(grandparentDocId)
                .creator(owner)
                .title("Grandparent")
                .build();
        Document trashedParent = Document.builder()
                .id(trashedParentId)
                .creator(owner)
                .title("Trashed Parent")
                .parent(grandparent)
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();
        Document child = Document.builder()
                .id(childDocId)
                .creator(owner)
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
        when(documentRepository.findAllForChainByIdIn(List.of(trashedParentId, grandparentDocId)))
                .thenReturn(List.of(trashedParent, grandparent));

        List<CollaboratorResponse> result = sharingService.listCollaborators(ownerId, childDocId);

        assertTrue(result.isEmpty());
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
    @Test
    void getSharingSettings_linkAncestorTheActorCannotSee_hidesItsProvenance() {
        UUID actorId = UUID.randomUUID();
        UUID ownerId = UUID.randomUUID();
        User owner = User.builder()
                .id(ownerId)
                .email("owner@example.com")
                .passwordHash("$2a$12$hash")
                .build();
        Document parent = Document.builder()
                .id(UUID.randomUUID())
                .creator(owner)
                .title("Secret parent")
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .linkAccessLevel(DocumentAccessLevel.EDIT)
                .build();
        Document child = Document.builder()
                .id(UUID.randomUUID())
                .creator(owner)
                .parent(parent)
                .generalAccessMode(DocumentGeneralAccessMode.RESTRICTED)
                .build();

        when(permissionService.requireReadAccessIncludingTrash(actorId, child.getId()))
                .thenReturn(child);
        stubAncestorChain(child, List.of(parent), List.of());
        when(permissionService.resolveIdentityAccessBatch(actorId, List.of(parent.getId())))
                .thenReturn(Map.of());

        SharingSettingsResponse response = settingsService.getSharingSettings(actorId, child.getId());

        // The effective link is inherited, but the source stays hidden from a caller who
        // cannot open that ancestor.
        assertTrue(response.inherited());
        assertNull(response.inheritedFromId());
        assertNull(response.inheritedFromTitle());
        assertEquals(DocumentAccessLevel.EDIT, response.linkAccessLevel());
    }

    @Test
    void updateSharingSettings_workspaceAudienceOnAChildPage_doesNotCreateOwnerPositions() {
        UUID actorId = UUID.randomUUID();
        Document parent = Document.builder().id(UUID.randomUUID()).build();
        Document doc = Document.builder()
                .id(UUID.randomUUID())
                .creator(User.builder().id(actorId).passwordHash("$2a$12$hash").build())
                .parent(parent)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, doc.getId())).thenReturn(doc);
        when(documentRepository.save(doc)).thenReturn(doc);

        settingsService.updateSharingSettings(
                actorId,
                doc.getId(),
                new SharingSettingsUpdateRequest(
                        null,
                        null,
                        null,
                        DocumentWorkspaceAccessMode.WORKSPACE_MEMBERS,
                        DocumentAccessLevel.EDIT,
                        null,
                        null,
                        null));

        // A nested page has no Shared-section root position of its own.
        verify(sharedSectionService, never()).ensureOrderRow(any(), any());
    }

    @Test
    void updateSharingSettings_workspaceAudienceOnASpacePage_doesNotCreateOwnerPositions() {
        UUID actorId = UUID.randomUUID();
        Space space = Space.builder()
                .id(UUID.randomUUID())
                .name("Engineering")
                .accessMode(SpaceAccessMode.CUSTOM)
                .build();
        Document doc = Document.builder()
                .id(UUID.randomUUID())
                .creator(User.builder().id(actorId).passwordHash("$2a$12$hash").build())
                .space(space)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, doc.getId())).thenReturn(doc);
        when(documentRepository.save(doc)).thenReturn(doc);

        settingsService.updateSharingSettings(
                actorId,
                doc.getId(),
                new SharingSettingsUpdateRequest(
                        null,
                        null,
                        null,
                        DocumentWorkspaceAccessMode.WORKSPACE_MEMBERS,
                        DocumentAccessLevel.EDIT,
                        null,
                        null,
                        null));

        verify(sharedSectionService, never()).ensureOrderRow(any(), any());
    }

    @Test
    void updateSharingSettings_workspaceAudienceOnARootPage_givesEveryOwnerAPosition() {
        UUID actorId = UUID.randomUUID();
        UUID firstOwnerId = UUID.randomUUID();
        UUID secondOwnerId = UUID.randomUUID();
        User firstOwner =
                User.builder().id(firstOwnerId).passwordHash("$2a$12$hash").build();
        User secondOwner =
                User.builder().id(secondOwnerId).passwordHash("$2a$12$hash").build();
        Document doc =
                Document.builder().id(UUID.randomUUID()).creator(firstOwner).build();

        when(permissionService.requireSharingAdminAccess(actorId, doc.getId())).thenReturn(doc);
        when(documentRepository.save(doc)).thenReturn(doc);
        AccessGrant editorGrant = AccessGrant.builder()
                .document(doc)
                .user(User.builder()
                        .id(UUID.randomUUID())
                        .passwordHash("$2a$12$hash")
                        .build())
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.EDIT)
                .build();
        when(accessGrantRepository.findPositiveUserGrantsByDocumentId(doc.getId()))
                .thenReturn(List.of(ownerGrant(doc, firstOwner), ownerGrant(doc, secondOwner), editorGrant));

        settingsService.updateSharingSettings(
                actorId,
                doc.getId(),
                new SharingSettingsUpdateRequest(
                        null,
                        null,
                        null,
                        DocumentWorkspaceAccessMode.WORKSPACE_MEMBERS,
                        DocumentAccessLevel.EDIT,
                        null,
                        null,
                        null));

        // Ownership is a grant row, so every owner gets the Shared position, not only
        // the one recorded as the creator.
        verify(sharedSectionService).ensureOrderRow(firstOwner, doc);
        verify(sharedSectionService).ensureOrderRow(secondOwner, doc);
    }

    @Test
    void getSharingSettings_publicSpaceWithoutEveryoneLevel_doesNotNameASource() {
        UUID actorId = UUID.randomUUID();
        Space space = Space.builder()
                .id(UUID.randomUUID())
                .name("Engineering")
                .accessMode(SpaceAccessMode.PUBLIC)
                .everyoneAccessLevel(null)
                .build();
        Document doc = Document.builder()
                .id(UUID.randomUUID())
                .creator(User.builder().id(actorId).passwordHash("$2a$12$hash").build())
                .space(space)
                .build();

        when(permissionService.requireReadAccessIncludingTrash(actorId, doc.getId()))
                .thenReturn(doc);

        SharingSettingsResponse response = settingsService.getSharingSettings(actorId, doc.getId());

        assertFalse(response.workspaceInherited());
        assertNull(response.workspaceInheritedFromId());
    }

    @Test
    void listCollaborators_duplicateAncestorGrantForSameUser_appearsOnce() {
        UUID ownerId = UUID.randomUUID();
        User owner = User.builder()
                .id(ownerId)
                .email("owner@example.com")
                .passwordHash("$2a$12$hash")
                .build();
        UUID memberId = UUID.randomUUID();
        User member = User.builder()
                .id(memberId)
                .email("member@example.com")
                .passwordHash("$2a$12$hash")
                .build();
        Document grandparent = Document.builder()
                .id(UUID.randomUUID())
                .creator(owner)
                .title("Grandparent")
                .build();
        Document parent = Document.builder()
                .id(UUID.randomUUID())
                .creator(owner)
                .title("Parent")
                .parent(grandparent)
                .build();
        Document child = Document.builder()
                .id(UUID.randomUUID())
                .creator(owner)
                .parent(parent)
                .build();
        AccessGrant nearer = AccessGrant.builder()
                .document(parent)
                .user(member)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.EDIT)
                .build();
        AccessGrant farther = AccessGrant.builder()
                .document(grandparent)
                .user(member)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.VIEW)
                .build();

        when(permissionService.requireReadAccessIncludingTrash(ownerId, child.getId()))
                .thenReturn(child);
        when(accessGrantRepository.findUserGrantsByDocumentId(child.getId())).thenReturn(List.of());
        stubAncestorChain(child, List.of(parent, grandparent), List.of(nearer, farther));

        List<CollaboratorResponse> roster = sharingService.listCollaborators(ownerId, child.getId());

        // The nearest ancestor row wins; the farther duplicate is not a second person.
        assertEquals(1, roster.size());
        assertEquals(memberId, roster.get(0).userId());
        assertEquals(DocumentAccessLevel.EDIT, roster.get(0).accessLevel());
        assertEquals(parent.getId(), roster.get(0).inheritedFromId());
    }

    @Test
    void hasHiddenSharingSources_visibleAncestorsWithoutSpace_returnsFalse() {
        UUID ownerId = UUID.randomUUID();
        User owner = User.builder()
                .id(ownerId)
                .email("owner@example.com")
                .passwordHash("$2a$12$hash")
                .build();
        Document parent = Document.builder()
                .id(UUID.randomUUID())
                .creator(owner)
                .title("Parent")
                .build();
        Document child = Document.builder()
                .id(UUID.randomUUID())
                .creator(owner)
                .parent(parent)
                .build();

        when(permissionService.requireReadAccessIncludingTrash(ownerId, child.getId()))
                .thenReturn(child);
        stubAncestorChain(child, List.of(parent), List.of());

        assertFalse(sharingService.hasHiddenSharingSources(ownerId, child.getId()));
    }

    @Test
    void listCollaborators_hidesAnInheritedPersonBehindAnInvisibleAncestor() {
        UUID ownerId = UUID.randomUUID();
        UUID requesterId = UUID.randomUUID();
        User owner = User.builder()
                .id(ownerId)
                .email("owner@example.com")
                .passwordHash("$2a$12$hash")
                .build();
        User requester = User.builder()
                .id(requesterId)
                .email("requester@example.com")
                .passwordHash("$2a$12$hash")
                .build();
        Document parent = Document.builder()
                .id(UUID.randomUUID())
                .creator(owner)
                .title("Secret")
                .build();
        Document child = Document.builder()
                .id(UUID.randomUUID())
                .creator(owner)
                .parent(parent)
                .build();
        AccessGrant inheritedUserGrant = AccessGrant.builder()
                .document(parent)
                .user(requester)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.EDIT)
                .build();

        when(permissionService.requireReadAccessIncludingTrash(requesterId, child.getId()))
                .thenReturn(child);
        when(accessGrantRepository.findUserGrantsByDocumentId(child.getId())).thenReturn(List.of());
        stubAncestorChain(child, List.of(parent), List.of(inheritedUserGrant));
        when(permissionService.resolveIdentityAccessBatch(requesterId, List.of(parent.getId())))
                .thenReturn(Map.of());

        assertTrue(sharingService.listCollaborators(requesterId, child.getId()).isEmpty());
    }

    @Test
    void hasHiddenSharingSources_visibleSpaceRoster_returnsFalse() {
        UUID requesterId = UUID.randomUUID();
        UUID spaceId = UUID.randomUUID();
        Space space = Space.builder().id(spaceId).name("Engineering").build();
        Document doc = Document.builder()
                .id(UUID.randomUUID())
                .creator(User.builder()
                        .id(UUID.randomUUID())
                        .passwordHash("$2a$12$hash")
                        .build())
                .space(space)
                .build();

        when(permissionService.requireReadAccessIncludingTrash(requesterId, doc.getId()))
                .thenReturn(doc);
        when(permissionService.resolveIdentityAccessBatch(requesterId, List.of()))
                .thenReturn(Map.of());

        assertFalse(sharingService.hasHiddenSharingSources(requesterId, doc.getId()));
    }

    @Test
    void upsertCollaborator_withoutACreator_resolvesTheActorFromTheAccount() {
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        User actor = User.builder()
                .id(actorId)
                .email("actor@example.com")
                .passwordHash("$2a$12$hash")
                .build();
        Document document = Document.builder().id(documentId).build();
        User targetUser = User.builder()
                .id(UUID.randomUUID())
                .email("alice@example.com")
                .passwordHash("$2a$12$hash")
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(document);
        when(userRepository.findByEmail("alice@example.com")).thenReturn(Optional.of(targetUser));
        when(userRepository.findById(actorId)).thenReturn(Optional.of(actor));

        sharingService.upsertCollaborator(
                actorId, documentId, new CollaboratorUpsertRequest("alice@example.com", DocumentAccessLevel.EDIT));

        verify(accessGrantSyncService).upsertUserGrant(document, targetUser, DocumentAccessLevel.EDIT, actor);
    }

    @Test
    void getMyAccess_spacePageAncestorOwnerWithMembership_canManageSharing() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID spaceId = UUID.randomUUID();
        Space space = Space.builder().id(spaceId).name("Engineering").build();
        Document document = Document.builder().id(documentId).space(space).build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(document));
        when(permissionService.resolveAccess(userId, documentId)).thenReturn(DocumentAccessLevel.EDIT);
        when(permissionService.resolveSpace(document)).thenReturn(space);
        when(spaceAccessService.load(userId, spaceId))
                .thenReturn(new SpaceContext(space, WorkspaceRole.MEMBER, DocumentAccessLevel.EDIT));
        when(permissionService.ownsAncestor(userId, document)).thenReturn(true);

        DocumentAccessResponse response = sharingService.getMyAccess(userId, documentId);

        assertTrue(response.canManageSharing());
    }

    @Test
    void hasHiddenSharingSources_hiddenSpaceRoster_returnsTrue() {
        UUID ownerId = UUID.randomUUID();
        UUID spaceId = UUID.randomUUID();
        Space space = Space.builder().id(spaceId).name("Engineering").build();
        Document doc = Document.builder()
                .id(UUID.randomUUID())
                .creator(User.builder().id(ownerId).passwordHash("$2a$12$hash").build())
                .space(space)
                .build();

        when(permissionService.requireReadAccessIncludingTrash(ownerId, doc.getId()))
                .thenReturn(doc);
        when(permissionService.resolveSpace(doc)).thenReturn(space);
        when(permissionService.resolveIdentityAccessBatch(ownerId, List.of())).thenReturn(Map.of());
        when(spaceMemberRepository.existsBySpace_IdAndUser_Id(spaceId, ownerId)).thenReturn(false);
        when(spaceAccessService.load(ownerId, spaceId)).thenThrow(new ApiException(ErrorCode.NOT_FOUND));

        assertTrue(sharingService.hasHiddenSharingSources(ownerId, doc.getId()));
    }

    @Test
    void upsertCollaborator_onSpacePage_doesNotCreateAnOwnerOrderRow() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Space space = Space.builder().id(UUID.randomUUID()).name("Engineering").build();
        User owner = User.builder()
                .id(ownerId)
                .email("owner@example.com")
                .passwordHash("$2a$12$hash")
                .build();
        Document document =
                Document.builder().id(documentId).creator(owner).space(space).build();
        User targetUser = User.builder()
                .id(UUID.randomUUID())
                .email("alice@example.com")
                .passwordHash("$2a$12$hash")
                .build();

        when(permissionService.requireSharingAdminAccess(ownerId, documentId)).thenReturn(document);
        when(permissionService.resolveSpace(document)).thenReturn(space);
        when(userRepository.findByEmail("alice@example.com")).thenReturn(Optional.of(targetUser));

        sharingService.upsertCollaborator(
                ownerId, documentId, new CollaboratorUpsertRequest("alice@example.com", DocumentAccessLevel.EDIT));

        // A space page's audience comes from the space, not a personal root position.
        verify(sharedSectionService).ensureOrderRow(targetUser, document);
        verify(sharedSectionService, never()).ensureOrderRow(owner, document);
    }

    @Test
    void updateCollaboratorAccess_onSpacePage_skipsTheLastOwnerGuard() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID memberId = UUID.randomUUID();
        Space space = Space.builder().id(UUID.randomUUID()).name("Engineering").build();
        User owner = User.builder().id(ownerId).passwordHash("$2a$12$hash").build();
        User member = User.builder().id(memberId).passwordHash("$2a$12$hash").build();
        Document document =
                Document.builder().id(documentId).creator(owner).space(space).build();
        AccessGrant existing = AccessGrant.builder()
                .document(document)
                .user(member)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.OWNER)
                .build();

        when(permissionService.requireSharingAdminAccess(ownerId, documentId)).thenReturn(document);
        when(permissionService.resolveSpace(document)).thenReturn(space);
        when(accessGrantRepository.findByDocument_IdAndUser_Id(documentId, memberId))
                .thenReturn(Optional.of(existing));
        when(accessGrantRepository.hasPositiveIdentityGrant(memberId, documentId))
                .thenReturn(true);

        sharingService.updateCollaboratorAccess(
                ownerId, documentId, memberId, new CollaboratorAccessUpdateRequest(DocumentAccessLevel.EDIT));

        // A space page's owner can be demoted: the space still administers the page.
        verify(accessGrantSyncService).upsertUserGrant(document, member, DocumentAccessLevel.EDIT, owner);
    }

    @Test
    void removeCollaborator_onSpacePage_skipsTheLastOwnerGuard() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID memberId = UUID.randomUUID();
        Space space = Space.builder().id(UUID.randomUUID()).name("Engineering").build();
        Document document = Document.builder()
                .id(documentId)
                .creator(User.builder().id(ownerId).passwordHash("$2a$12$hash").build())
                .space(space)
                .build();

        when(permissionService.requireSharingAdminAccess(ownerId, documentId)).thenReturn(document);
        when(permissionService.resolveSpace(document)).thenReturn(space);
        when(accessGrantRepository.existsByDocument_IdAndUser_Id(documentId, memberId))
                .thenReturn(true);

        sharingService.removeCollaborator(ownerId, documentId, memberId);

        // The guard would have thrown, because no other page owner exists.
        verify(accessGrantRepository).deleteByDocument_IdAndUser_Id(documentId, memberId);
    }

    @Test
    void leaveSharedDocument_onSpacePage_skipsTheLastOwnerGuard() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Space space = Space.builder().id(UUID.randomUUID()).name("Engineering").build();
        Document document = Document.builder()
                .id(documentId)
                .creator(User.builder()
                        .id(UUID.randomUUID())
                        .passwordHash("$2a$12$hash")
                        .build())
                .space(space)
                .build();

        when(permissionService.requireReadAccessIncludingTrash(userId, documentId))
                .thenReturn(document);
        when(permissionService.resolveSpace(document)).thenReturn(space);
        when(accessGrantRepository.findByDocument_IdAndUser_Id(documentId, userId))
                .thenReturn(Optional.of(
                        AccessGrant.builder().effect(AccessGrantEffect.ALLOW).build()));

        sharingService.leaveSharedDocument(userId, documentId);

        // The guard would have thrown, because the caller is the only page owner.
        verify(accessGrantRepository).deleteByDocument_IdAndUser_Id(documentId, userId);
    }

    @Test
    void getMyAccess_onTrashedDocumentAsOwner_reportsOwner() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document trashed = Document.builder()
                .id(documentId)
                .creator(User.builder().id(ownerId).passwordHash("$2a$12$hash").build())
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.empty());
        when(permissionService.resolveTrashAccess(ownerId, documentId)).thenReturn(DocumentAccessLevel.OWNER);
        when(documentRepository.findById(documentId)).thenReturn(Optional.of(trashed));

        DocumentAccessResponse response = sharingService.getMyAccess(ownerId, documentId);

        assertTrue(response.allowed());
        assertTrue(response.owner());
        assertTrue(response.trashed());
    }

    @Test
    void getMyAccess_privatePageOwner_canManageSharing() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = Document.builder()
                .id(documentId)
                .creator(User.builder().id(ownerId).passwordHash("$2a$12$hash").build())
                .build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(document));
        when(permissionService.resolveAccess(ownerId, documentId)).thenReturn(DocumentAccessLevel.OWNER);
        when(permissionService.resolveSpace(document)).thenReturn(null);

        DocumentAccessResponse response = sharingService.getMyAccess(ownerId, documentId);

        assertTrue(response.canManageSharing());
    }

    @Test
    void getMyAccess_spacePageAncestorOwnerWithoutMembership_canManageSharing() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID spaceId = UUID.randomUUID();
        Space space = Space.builder().id(spaceId).name("Engineering").build();
        Document document = Document.builder().id(documentId).space(space).build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(document));
        when(permissionService.resolveAccess(userId, documentId)).thenReturn(DocumentAccessLevel.EDIT);
        when(permissionService.resolveSpace(document)).thenReturn(space);
        when(spaceAccessService.load(userId, spaceId)).thenThrow(new ApiException(ErrorCode.NOT_FOUND));
        when(permissionService.ownsAncestor(userId, document)).thenReturn(true);

        DocumentAccessResponse response = sharingService.getMyAccess(userId, documentId);

        assertTrue(response.canManageSharing());
        assertNull(response.space());
    }

    @Test
    void getMyAccess_spaceAdministrator_canManageSharing() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID spaceId = UUID.randomUUID();
        Space space = Space.builder()
                .id(spaceId)
                .name("Engineering")
                .accessMode(SpaceAccessMode.CUSTOM)
                .build();
        Document document = Document.builder().id(documentId).space(space).build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(document));
        when(permissionService.resolveAccess(userId, documentId)).thenReturn(DocumentAccessLevel.VIEW);
        when(permissionService.resolveSpace(document)).thenReturn(space);
        when(spaceAccessService.load(userId, spaceId))
                .thenReturn(new SpaceContext(space, WorkspaceRole.MEMBER, DocumentAccessLevel.OWNER));

        DocumentAccessResponse response = sharingService.getMyAccess(userId, documentId);

        assertTrue(response.canManageSharing());
        assertNotNull(response.space());
    }

    @Test
    void getMyAccess_archivedSpaceWithMembership_cannotManageSharing() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID spaceId = UUID.randomUUID();
        Space space = Space.builder()
                .id(spaceId)
                .name("Engineering")
                .accessMode(SpaceAccessMode.CUSTOM)
                .archivedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();
        Document document = Document.builder().id(documentId).space(space).build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(document));
        when(permissionService.resolveAccess(userId, documentId)).thenReturn(DocumentAccessLevel.OWNER);
        when(permissionService.resolveSpace(document)).thenReturn(space);
        when(spaceAccessService.load(userId, spaceId))
                .thenReturn(new SpaceContext(space, WorkspaceRole.MEMBER, DocumentAccessLevel.OWNER));

        DocumentAccessResponse response = sharingService.getMyAccess(userId, documentId);

        assertFalse(response.canManageSharing());
        assertEquals(DocumentAccessLevel.VIEW, response.space().myAccessLevel());
    }

    @Test
    void getMyAccess_spacePageWithoutAdministrationOrAncestors_cannotManageSharing() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID spaceId = UUID.randomUUID();
        Space space = Space.builder().id(spaceId).name("Engineering").build();
        Document document = Document.builder().id(documentId).space(space).build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(document));
        when(permissionService.resolveAccess(userId, documentId)).thenReturn(DocumentAccessLevel.EDIT);
        when(permissionService.resolveSpace(document)).thenReturn(space);
        when(spaceAccessService.load(userId, spaceId))
                .thenReturn(new SpaceContext(space, WorkspaceRole.MEMBER, DocumentAccessLevel.EDIT));

        DocumentAccessResponse response = sharingService.getMyAccess(userId, documentId);

        assertFalse(response.canManageSharing());
        assertNotNull(response.space());
    }

    @Test
    void leaveSharedDocument_reconcileFloatsARootWithoutAParentRow() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        User user = User.builder().id(userId).passwordHash("$2a$12$hash").build();
        Document document = Document.builder()
                .id(documentId)
                .creator(User.builder()
                        .id(UUID.randomUUID())
                        .passwordHash("$2a$12$hash")
                        .build())
                .build();

        when(permissionService.requireReadAccessIncludingTrash(userId, documentId))
                .thenReturn(document);
        when(accessGrantRepository.findByDocument_IdAndUser_Id(documentId, userId))
                .thenReturn(Optional.of(
                        AccessGrant.builder().effect(AccessGrantEffect.ALLOW).build()));
        when(permissionService.resolveAccess(userId, documentId)).thenReturn(DocumentAccessLevel.VIEW);
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of(documentId));
        when(documentRepository.findParentIdsByIdIn(List.of(documentId)))
                .thenReturn(List.<Object[]>of(new Object[] {documentId, null}));
        when(documentRepository.findAllForChainByIdIn(any())).thenReturn(List.of(document));
        when(permissionService.resolveIdentityAccessBatch(eq(userId), any()))
                .thenReturn(Map.of(documentId, DocumentAccessLevel.VIEW));

        sharingService.leaveSharedDocument(userId, documentId);

        // A root has no parent row, so sharing it again needs a fresh position.
        verify(sharedSectionService).ensureOrderRows(user, List.of(document));
    }

    @Test
    void leaveSharedDocument_reconcileKeepsRowWhileTheParentIsStillReachable() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID parentId = UUID.randomUUID();
        User user = User.builder().id(userId).passwordHash("$2a$12$hash").build();
        Document document = Document.builder()
                .id(documentId)
                .creator(User.builder()
                        .id(UUID.randomUUID())
                        .passwordHash("$2a$12$hash")
                        .build())
                .parent(Document.builder().id(parentId).build())
                .build();

        when(permissionService.requireReadAccessIncludingTrash(userId, documentId))
                .thenReturn(document);
        when(accessGrantRepository.findByDocument_IdAndUser_Id(documentId, userId))
                .thenReturn(Optional.of(
                        AccessGrant.builder().effect(AccessGrantEffect.ALLOW).build()));
        when(permissionService.resolveAccess(userId, documentId)).thenReturn(DocumentAccessLevel.VIEW);
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of(documentId));
        when(documentRepository.findParentIdsByIdIn(List.of(documentId)))
                .thenReturn(List.<Object[]>of(new Object[] {documentId, parentId}));
        when(documentRepository.findAllForChainByIdIn(any())).thenReturn(List.of(document));
        when(permissionService.resolveIdentityAccessBatch(eq(userId), any()))
                .thenReturn(Map.of(documentId, DocumentAccessLevel.VIEW, parentId, DocumentAccessLevel.EDIT));

        sharingService.leaveSharedDocument(userId, documentId);

        // The parent still exposes the page, so the caller's Shared row is not a root entry.
        verify(userSharedOrderRepository, times(2)).deleteByUser_IdAndDocument_Id(userId, documentId);
        verify(sharedSectionService, never()).ensureOrderRows(any(), any());
    }

    @Test
    void leaveSharedDocument_reconcileFloatsThePageWhenTheParentIsNotReachable() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID parentId = UUID.randomUUID();
        User user = User.builder().id(userId).passwordHash("$2a$12$hash").build();
        Document document = Document.builder()
                .id(documentId)
                .creator(User.builder()
                        .id(UUID.randomUUID())
                        .passwordHash("$2a$12$hash")
                        .build())
                .parent(Document.builder().id(parentId).build())
                .build();

        when(permissionService.requireReadAccessIncludingTrash(userId, documentId))
                .thenReturn(document);
        when(accessGrantRepository.findByDocument_IdAndUser_Id(documentId, userId))
                .thenReturn(Optional.of(
                        AccessGrant.builder().effect(AccessGrantEffect.ALLOW).build()));
        when(permissionService.resolveAccess(userId, documentId)).thenReturn(DocumentAccessLevel.VIEW);
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(documentRepository.findSubtreeDocumentIds(documentId)).thenReturn(List.of(documentId));
        when(documentRepository.findParentIdsByIdIn(List.of(documentId)))
                .thenReturn(List.<Object[]>of(new Object[] {documentId, parentId}));
        when(documentRepository.findAllForChainByIdIn(any())).thenReturn(List.of(document));
        when(permissionService.resolveIdentityAccessBatch(eq(userId), any()))
                .thenReturn(Map.of(documentId, DocumentAccessLevel.VIEW));

        sharingService.leaveSharedDocument(userId, documentId);

        // The page resolves on its own but not through its parent, so it becomes a
        // Shared root with a personal position.
        verify(sharedSectionService).ensureOrderRows(user, List.of(document));
    }

    private void stubAncestorChain(Document target, List<Document> ancestors, List<AccessGrant> rows) {
        List<UUID> ancestorIds = ancestors.stream().map(Document::getId).toList();
        UUID ownerId = target.getCreator().getId();
        org.mockito.Mockito.lenient()
                .when(accessGrantRepository.hasPositiveIdentityGrant(ownerId, target.getId()))
                .thenReturn(true);
        Map<UUID, DocumentAccessLevel> ownerAccess = new HashMap<>();
        for (Document ancestor : ancestors) {
            ownerAccess.put(ancestor.getId(), DocumentAccessLevel.OWNER);
            org.mockito.Mockito.lenient()
                    .when(permissionService.resolveIdentityAccessBatch(ownerId, List.of(ancestor.getId())))
                    .thenReturn(Map.of(ancestor.getId(), DocumentAccessLevel.OWNER));
        }
        org.mockito.Mockito.lenient()
                .when(permissionService.resolveIdentityAccessBatch(ownerId, ancestorIds))
                .thenReturn(ownerAccess);
        when(documentRepository.findAncestorChainIds(target.getId())).thenReturn(ancestorIds);
        if (ancestorIds.isEmpty()) {
            return;
        }
        when(documentRepository.findAllForChainByIdIn(ancestorIds)).thenReturn(ancestors);
        if (!rows.isEmpty()) {
            when(accessGrantRepository.findUserGrantsByDocumentIdIn(ancestorIds))
                    .thenReturn(rows);
        }
    }

    private static AccessGrant ownerGrant(Document doc, User user) {
        return AccessGrant.builder()
                .id(UUID.randomUUID())
                .document(doc)
                .user(user)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.OWNER)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();
    }

    private static Document createSharedDocument(UUID documentId, DocumentAccessLevel linkAccessLevel) {
        User owner = User.builder()
                .id(UUID.randomUUID())
                .email("owner@example.com")
                .displayName("Owner")
                .passwordHash("$2a$12$hash")
                .build();

        return Document.builder()
                .id(documentId)
                .creator(owner)
                .title("Shared doc")
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
                .passwordHash("$2a$12$hash")
                .build();

        User memberUser = User.builder()
                .id(UUID.randomUUID())
                .email("member@example.com")
                .displayName("Member")
                .passwordHash("$2a$12$hash")
                .build();

        Document doc = Document.builder()
                .id(documentId)
                .title("Architecture")
                .creator(creator)
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
                .passwordHash("$2a$12$hash")
                .build();

        User memberUser = User.builder()
                .id(memberId)
                .email("member@example.com")
                .displayName("Member")
                .passwordHash("$2a$12$hash")
                .build();

        Document doc = Document.builder()
                .id(documentId)
                .title("Roadmap")
                .creator(creator)
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
    void listCollaborators_directGrantInPublicSpace_reportsNoOverrideProvenance() {
        UUID requesterId = UUID.randomUUID();
        UUID spaceId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID collaboratorId = UUID.randomUUID();

        // Everyone in the workspace already has EDIT through the space's public access;
        // the page adds one person, which overrides nothing.
        Space space = Space.builder()
                .id(spaceId)
                .name("Product")
                .accessMode(SpaceAccessMode.PUBLIC)
                .everyoneAccessLevel(DocumentAccessLevel.EDIT)
                .build();
        User collaborator = User.builder()
                .id(collaboratorId)
                .email("collaborator@example.com")
                .displayName("Collaborator")
                .passwordHash("$2a$12$hash")
                .build();
        Document doc = Document.builder()
                .id(documentId)
                .title("Roadmap")
                .creator(User.builder()
                        .id(requesterId)
                        .passwordHash("$2a$12$hash")
                        .build())
                .space(space)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();
        AccessGrant directGrant = AccessGrant.builder()
                .id(UUID.randomUUID())
                .document(doc)
                .user(collaborator)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.COMMENT)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(permissionService.requireReadAccessIncludingTrash(requesterId, documentId))
                .thenReturn(doc);
        when(permissionService.resolveSpace(doc)).thenReturn(space);
        when(spaceAccessService.load(requesterId, spaceId))
                .thenReturn(new SpaceContext(space, WorkspaceRole.OWNER, DocumentAccessLevel.OWNER));
        when(spaceMemberRepository.findAllBySpace_IdOrderByCreatedAtAsc(spaceId))
                .thenReturn(List.of());
        when(accessGrantRepository.findUserGrantsByDocumentId(documentId)).thenReturn(List.of(directGrant));
        when(documentRepository.findAncestorChainIds(documentId)).thenReturn(List.of());

        List<CollaboratorResponse> roster = sharingService.listCollaborators(requesterId, documentId);

        assertEquals(1, roster.size());
        CollaboratorResponse row = roster.get(0);
        assertEquals(collaboratorId, row.userId());
        assertFalse(row.inherited());
        assertNull(row.inheritedFromId());
        assertNull(row.inheritedFromTitle());
        assertNull(row.inheritedAccessLevel());
    }

    @Test
    void listCollaborators_blockInPublicSpace_reportsEveryoneAccessProvenance() {
        UUID requesterId = UUID.randomUUID();
        UUID spaceId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID collaboratorId = UUID.randomUUID();

        Space space = Space.builder()
                .id(spaceId)
                .name("Product")
                .accessMode(SpaceAccessMode.PUBLIC)
                .everyoneAccessLevel(DocumentAccessLevel.EDIT)
                .build();
        User collaborator = User.builder()
                .id(collaboratorId)
                .email("collaborator@example.com")
                .displayName("Collaborator")
                .passwordHash("$2a$12$hash")
                .build();
        Document doc = Document.builder()
                .id(documentId)
                .title("Roadmap")
                .creator(User.builder()
                        .id(requesterId)
                        .passwordHash("$2a$12$hash")
                        .build())
                .space(space)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();
        AccessGrant block = AccessGrant.builder()
                .id(UUID.randomUUID())
                .document(doc)
                .user(collaborator)
                .effect(AccessGrantEffect.DENY)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(permissionService.requireReadAccessIncludingTrash(requesterId, documentId))
                .thenReturn(doc);
        when(permissionService.resolveSpace(doc)).thenReturn(space);
        when(spaceAccessService.load(requesterId, spaceId))
                .thenReturn(new SpaceContext(space, WorkspaceRole.OWNER, DocumentAccessLevel.OWNER));
        when(spaceMemberRepository.findAllBySpace_IdOrderByCreatedAtAsc(spaceId))
                .thenReturn(List.of());
        when(accessGrantRepository.findUserGrantsByDocumentId(documentId)).thenReturn(List.of(block));
        when(documentRepository.findAncestorChainIds(documentId)).thenReturn(List.of());

        List<CollaboratorResponse> roster = sharingService.listCollaborators(requesterId, documentId);

        assertEquals(1, roster.size());
        CollaboratorResponse row = roster.get(0);
        assertEquals(collaboratorId, row.userId());
        // The block is what the panel explains: it removes access the space would carry.
        assertEquals(spaceId, row.inheritedFromId());
        assertEquals("Product", row.inheritedFromTitle());
        assertEquals(DocumentAccessLevel.EDIT, row.inheritedAccessLevel());
        assertEquals(DocumentAccessLevel.NO_ACCESS, row.accessLevel());
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
        assertFalse(response.trashed());
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
        assertFalse(response.trashed());
        assertTrue(response.canManageSharing());
        assertNull(response.space());
    }

    @Test
    void getCollaborators_creatorRemovedFromSpaceWithPublicLink_deniesRosterAccess() {
        UUID creatorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID spaceId = UUID.randomUUID();
        Space space = Space.builder().id(spaceId).name("Engineering").build();

        User creator = User.builder()
                .id(creatorId)
                .email("creator@example.com")
                .passwordHash("$2a$12$hash")
                .build();

        Document document = Document.builder()
                .id(documentId)
                .creator(creator)
                .title("Space doc")
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .build();

        when(permissionService.requireReadAccessIncludingTrash(creatorId, documentId))
                .thenReturn(document);
        // A live public link grants read, but the removed creator has no space standing
        // left to turn that read into roster visibility.
        doThrow(new ApiException(ErrorCode.NOT_FOUND)).when(permissionService).requireRosterAccess(creatorId, document);

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
        assertFalse(response.trashed());
        assertFalse(response.canManageSharing());
        assertNull(response.space());
    }

    @Test
    void listCollaborators_publicSpace_workspaceMemberNotListedInSpaceDoesNotGetSpaceRoster() {
        UUID requesterId = UUID.randomUUID();
        UUID spaceId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        Space space = Space.builder()
                .id(spaceId)
                .name("Public Company Docs")
                .accessMode(SpaceAccessMode.PUBLIC)
                .everyoneAccessLevel(DocumentAccessLevel.VIEW)
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

        when(permissionService.requireReadAccessIncludingTrash(actorId, docId)).thenReturn(doc);
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

        User owner = User.builder().id(ownerId).passwordHash("$2a$12$hash").build();

        User bob = User.builder().id(bobId).passwordHash("$2a$12$hash").build();
        Document document = Document.builder().id(documentId).creator(owner).build();
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

    @Test
    void removeCollaborator_lastOwner_throwsConflict() {
        UUID creatorId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID bobId = UUID.randomUUID();
        User creator = User.builder().id(creatorId).passwordHash("$2a$12$hash").build();
        User bob = User.builder().id(bobId).passwordHash("$2a$12$hash").build();
        Document document = Document.builder().id(documentId).creator(creator).build();
        AccessGrant creatorOverride = AccessGrant.builder()
                .document(document)
                .user(creator)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.EDIT)
                .build();
        AccessGrant bobOwner = AccessGrant.builder()
                .document(document)
                .user(bob)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.OWNER)
                .build();

        when(permissionService.requireSharingAdminAccess(actorId, documentId)).thenReturn(document);
        when(accessGrantRepository.findPositiveUserGrantsByDocumentId(documentId))
                .thenReturn(List.of(creatorOverride, bobOwner));
        when(permissionService.resolveAccess(bobId, documentId)).thenReturn(DocumentAccessLevel.OWNER);

        ApiException ex =
                assertThrows(ApiException.class, () -> sharingService.removeCollaborator(actorId, documentId, bobId));
        assertEquals(ErrorCode.CONFLICT, ex.getErrorCode());
        verify(accessGrantRepository, never()).deleteByDocument_IdAndUser_Id(any(), any());
    }

    @Test
    void leaveSharedDocument_lastOwner_throwsConflict() {
        UUID creatorId = UUID.randomUUID();
        UUID bobId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        User creator = User.builder().id(creatorId).passwordHash("$2a$12$hash").build();
        User bob = User.builder().id(bobId).passwordHash("$2a$12$hash").build();
        Document document = Document.builder().id(documentId).creator(creator).build();
        AccessGrant creatorOverride = AccessGrant.builder()
                .document(document)
                .user(creator)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.EDIT)
                .build();
        AccessGrant bobOwner = AccessGrant.builder()
                .document(document)
                .user(bob)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.OWNER)
                .build();

        when(permissionService.requireReadAccessIncludingTrash(bobId, documentId))
                .thenReturn(document);
        when(accessGrantRepository.findByDocument_IdAndUser_Id(documentId, bobId))
                .thenReturn(Optional.of(bobOwner));
        when(accessGrantRepository.findPositiveUserGrantsByDocumentId(documentId))
                .thenReturn(List.of(creatorOverride, bobOwner));
        when(permissionService.resolveAccess(bobId, documentId)).thenReturn(DocumentAccessLevel.OWNER);

        ApiException ex = assertThrows(ApiException.class, () -> sharingService.leaveSharedDocument(bobId, documentId));
        assertEquals(ErrorCode.CONFLICT, ex.getErrorCode());
        verify(accessGrantRepository, never()).deleteByDocument_IdAndUser_Id(any(), any());
    }

    @Test
    void leaveSharedDocument_creatorWithAnotherOwner_removesTheirOwnGrant() {
        UUID creatorId = UUID.randomUUID();
        UUID bobId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        User creator = User.builder().id(creatorId).passwordHash("$2a$12$hash").build();
        User bob = User.builder().id(bobId).passwordHash("$2a$12$hash").build();
        Document document = Document.builder().id(documentId).creator(creator).build();
        AccessGrant creatorOwner = ownerGrant(document, creator);
        AccessGrant bobOwner = ownerGrant(document, bob);

        when(permissionService.requireReadAccessIncludingTrash(creatorId, documentId))
                .thenReturn(document);
        when(permissionService.resolveSpace(document)).thenReturn(null);
        when(accessGrantRepository.findByDocument_IdAndUser_Id(documentId, creatorId))
                .thenReturn(Optional.of(creatorOwner));
        when(permissionService.resolveAccess(creatorId, documentId)).thenReturn(DocumentAccessLevel.OWNER);
        when(accessGrantRepository.findPositiveUserGrantsByDocumentId(documentId))
                .thenReturn(List.of(creatorOwner, bobOwner));
        when(permissionService.resolveAccessForUsers(eq(documentId), any(), eq(false)))
                .thenReturn(Map.of(bobId, DocumentAccessLevel.OWNER));

        sharingService.leaveSharedDocument(creatorId, documentId);

        // Ownership is a grant row, so the page keeps its other owner. Nothing about the
        // creator's identity is rewritten.
        assertEquals(creatorId, document.getCreator().getId());
        verify(accessGrantRepository).deleteByDocument_IdAndUser_Id(documentId, creatorId);
        verify(userSharedOrderRepository).deleteByUser_IdAndDocument_Id(creatorId, documentId);
        assertTrue(publishedEvents.stream().anyMatch(DocumentAccessChangedEvent.class::isInstance));
    }

    @Test
    void leaveSharedDocument_soleCreator_throwsConflict() {
        UUID creatorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        User creator = User.builder().id(creatorId).passwordHash("$2a$12$hash").build();
        Document document = Document.builder().id(documentId).creator(creator).build();

        when(permissionService.requireReadAccessIncludingTrash(creatorId, documentId))
                .thenReturn(document);
        when(permissionService.resolveSpace(document)).thenReturn(null);
        when(accessGrantRepository.findByDocument_IdAndUser_Id(documentId, creatorId))
                .thenReturn(Optional.of(ownerGrant(document, creator)));
        when(permissionService.resolveAccess(creatorId, documentId)).thenReturn(DocumentAccessLevel.OWNER);
        when(accessGrantRepository.findPositiveUserGrantsByDocumentId(documentId))
                .thenReturn(List.of(ownerGrant(document, creator)));

        ApiException ex =
                assertThrows(ApiException.class, () -> sharingService.leaveSharedDocument(creatorId, documentId));

        assertEquals(ErrorCode.CONFLICT, ex.getErrorCode());
        assertEquals(creatorId, document.getCreator().getId());
        verify(documentRepository, never()).save(any());
    }
}
