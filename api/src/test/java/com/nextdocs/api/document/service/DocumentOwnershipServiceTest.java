package com.nextdocs.api.document.service;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.entity.AccessGrant;
import com.nextdocs.api.document.entity.AccessGrantEffect;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.repository.AccessGrantRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.space.entity.Space;
import com.nextdocs.api.space.entity.SpaceMember;
import com.nextdocs.api.space.repository.SpaceMemberRepository;
import com.nextdocs.api.user.entity.User;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class DocumentOwnershipServiceTest {

    @Mock
    private DocumentRepository documentRepository;

    @Mock
    private AccessGrantRepository accessGrantRepository;

    @Mock
    private PermissionService permissionService;

    @Mock
    private SpaceMemberRepository spaceMemberRepository;

    private DocumentOwnershipService ownershipService;

    @BeforeEach
    void setUp() {
        ownershipService = new DocumentOwnershipService(
                documentRepository, accessGrantRepository, permissionService, spaceMemberRepository);
    }

    @Test
    void inheritedOwnerBlockMessage_privatePageAncestorOwner_returnsMessage() {
        UUID documentId = UUID.randomUUID();
        UUID parentId = UUID.randomUUID();
        UUID targetUserId = UUID.randomUUID();
        Document parent = Document.builder()
                .id(parentId)
                .creator(User.builder()
                        .id(UUID.randomUUID())
                        .passwordHash("$2a$12$hash")
                        .build())
                .title("Parent Wiki")
                .build();
        Document doc = Document.builder().id(documentId).parent(parent).build();

        when(permissionService.ownsAncestor(targetUserId, doc)).thenReturn(true);

        assertEquals(
                "An inherited owner cannot be set to No access on this page.",
                ownershipService.inheritedOwnerBlockMessage(doc, targetUserId));
    }

    @Test
    void inheritedOwnerBlockMessage_privatePageWorkspaceOwnerIsNotProtected() {
        Document doc = Document.builder().id(UUID.randomUUID()).build();

        assertNull(ownershipService.inheritedOwnerBlockMessage(doc, UUID.randomUUID()));
        verify(permissionService, never()).isWorkspaceOwner(any(), any());
    }

    @Test
    void inheritedOwnerBlockMessage_spaceOwner_returnsMessage() {
        UUID spaceId = UUID.randomUUID();
        UUID targetUserId = UUID.randomUUID();
        Space space = Space.builder().id(spaceId).name("Engineering").build();
        Document doc = Document.builder().id(UUID.randomUUID()).space(space).build();

        when(permissionService.resolveSpace(doc)).thenReturn(space);
        when(permissionService.isWorkspaceOwner(targetUserId, doc)).thenReturn(false);
        when(spaceMemberRepository.findBySpace_IdAndUser_Id(spaceId, targetUserId))
                .thenReturn(Optional.of(SpaceMember.builder()
                        .id(UUID.randomUUID())
                        .space(space)
                        .accessLevel(DocumentAccessLevel.OWNER)
                        .build()));

        assertEquals(
                "An inherited owner cannot be set to No access on this page.",
                ownershipService.inheritedOwnerBlockMessage(doc, targetUserId));
    }

    @Test
    void requireAnotherOwner_ancestorOwner_doesNotThrow() {
        UUID documentId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        Document doc = Document.builder().id(documentId).build();

        when(permissionService.ownsAncestor(userId, doc)).thenReturn(true);

        assertDoesNotThrow(() -> ownershipService.requireAnotherOwner(doc, userId, "last owner"));
        verifyNoInteractions(accessGrantRepository, documentRepository);
    }

    @Test
    void requireAnotherOwner_checksResolvedOwnerInsteadOfGrantLabel() {
        UUID id = UUID.randomUUID();
        UUID caller = UUID.randomUUID();
        UUID other = UUID.randomUUID();
        Document doc = Document.builder().id(id).build();
        AccessGrant grant = AccessGrant.builder()
                .user(User.builder().id(other).build())
                .accessLevel(DocumentAccessLevel.OWNER)
                .build();
        when(accessGrantRepository.findPositiveUserGrantsByDocumentId(id)).thenReturn(List.of(grant));
        when(permissionService.resolveAccessForUsers(id, Set.of(other), false))
                .thenReturn(Map.of(other, DocumentAccessLevel.VIEW), Map.of(other, DocumentAccessLevel.OWNER));
        assertThrows(ApiException.class, () -> ownershipService.requireAnotherOwner(doc, caller, "last owner"));
        assertDoesNotThrow(() -> ownershipService.requireAnotherOwner(doc, caller, "last owner"));
    }

    @Test
    void inheritedOwnerBlockMessage_ancestorOwnershipResolvesInTheTrashScopeForATrashedDocument() {
        UUID user = UUID.randomUUID();
        UUID parentId = UUID.randomUUID();
        Document doc = Document.builder()
                .id(UUID.randomUUID())
                .parent(Document.builder().id(parentId).build())
                .deletedAt(OffsetDateTime.now())
                .build();
        // ownsAncestor picks the trash resolver from the document's own state.
        when(permissionService.ownsAncestor(user, doc)).thenReturn(true);
        assertEquals(
                "An inherited owner cannot be set to No access on this page.",
                ownershipService.inheritedOwnerBlockMessage(doc, user));
        verify(permissionService, never()).resolveAccess(any(), any());
    }

    @Test
    void inheritedOwnerBlockMessage_spaceMemberWithoutOwner_isNotProtected() {
        UUID spaceId = UUID.randomUUID();
        UUID targetUserId = UUID.randomUUID();
        Space space = Space.builder().id(spaceId).name("Engineering").build();
        Document doc = Document.builder().id(UUID.randomUUID()).space(space).build();

        when(permissionService.resolveSpace(doc)).thenReturn(space);
        when(permissionService.isWorkspaceOwner(targetUserId, doc)).thenReturn(false);
        when(spaceMemberRepository.findBySpace_IdAndUser_Id(spaceId, targetUserId))
                .thenReturn(Optional.of(SpaceMember.builder()
                        .id(UUID.randomUUID())
                        .space(space)
                        .accessLevel(DocumentAccessLevel.EDIT)
                        .build()));

        assertNull(ownershipService.inheritedOwnerBlockMessage(doc, targetUserId));
    }

    @Test
    void inheritedOwnerBlockMessage_spacePageWithNoMembership_isNotProtected() {
        UUID spaceId = UUID.randomUUID();
        UUID targetUserId = UUID.randomUUID();
        Space space = Space.builder().id(spaceId).name("Engineering").build();
        Document doc = Document.builder().id(UUID.randomUUID()).space(space).build();

        when(permissionService.resolveSpace(doc)).thenReturn(space);
        when(permissionService.isWorkspaceOwner(targetUserId, doc)).thenReturn(false);
        when(spaceMemberRepository.findBySpace_IdAndUser_Id(spaceId, targetUserId))
                .thenReturn(Optional.empty());

        assertNull(ownershipService.inheritedOwnerBlockMessage(doc, targetUserId));
    }

    @Test
    void requireAnotherOwner_ancestorOwnerGrant_isAnotherOwner() {
        UUID documentId = UUID.randomUUID();
        UUID parentId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID otherOwner = UUID.randomUUID();
        UUID editor = UUID.randomUUID();
        Document parent = Document.builder().id(parentId).build();
        Document doc = Document.builder().id(documentId).parent(parent).build();
        AccessGrant ownerGrant = AccessGrant.builder()
                .document(parent)
                .user(User.builder().id(otherOwner).build())
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.OWNER)
                .build();
        AccessGrant editorGrant = AccessGrant.builder()
                .document(parent)
                .user(User.builder().id(editor).build())
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.EDIT)
                .build();
        AccessGrant denyGrant = AccessGrant.builder()
                .document(parent)
                .user(User.builder().id(UUID.randomUUID()).build())
                .effect(AccessGrantEffect.DENY)
                .accessLevel(DocumentAccessLevel.NO_ACCESS)
                .build();

        when(permissionService.ownsAncestor(userId, doc)).thenReturn(false);
        when(accessGrantRepository.findPositiveUserGrantsByDocumentId(documentId))
                .thenReturn(List.of());
        when(documentRepository.findAncestorChainIds(documentId)).thenReturn(List.of(parentId));
        when(documentRepository.findAllForChainByIdIn(List.of(parentId))).thenReturn(List.of(parent));
        when(accessGrantRepository.findUserGrantsByDocumentIdIn(List.of(parentId)))
                .thenReturn(List.of(ownerGrant, editorGrant, denyGrant));
        when(permissionService.resolveAccessForUsers(documentId, Set.of(otherOwner), false))
                .thenReturn(Map.of(otherOwner, DocumentAccessLevel.OWNER));

        assertDoesNotThrow(() -> ownershipService.requireAnotherOwner(doc, userId, "last owner"));
    }

    @Test
    void requireAnotherOwner_trashedDocument_usesTheTrashResolver() {
        UUID documentId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID otherOwner = UUID.randomUUID();
        Document doc = Document.builder()
                .id(documentId)
                .deletedAt(OffsetDateTime.now())
                .build();
        AccessGrant ownerGrant = AccessGrant.builder()
                .document(doc)
                .user(User.builder().id(otherOwner).build())
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.OWNER)
                .build();

        when(permissionService.ownsAncestor(userId, doc)).thenReturn(false);
        when(accessGrantRepository.findPositiveUserGrantsByDocumentId(documentId))
                .thenReturn(List.of(ownerGrant));
        when(permissionService.resolveAccessForUsers(documentId, Set.of(otherOwner), true))
                .thenReturn(Map.of(otherOwner, DocumentAccessLevel.OWNER));

        assertDoesNotThrow(() -> ownershipService.requireAnotherOwner(doc, userId, "last owner"));
    }

    @Test
    void requireAnotherOwner_lastOwner_throws() {
        UUID documentId = UUID.randomUUID();
        UUID creatorId = UUID.randomUUID();
        Document doc = Document.builder()
                .id(documentId)
                .creator(
                        User.builder().id(creatorId).passwordHash("$2a$12$hash").build())
                .build();

        when(permissionService.ownsAncestor(creatorId, doc)).thenReturn(false);
        when(accessGrantRepository.findPositiveUserGrantsByDocumentId(documentId))
                .thenReturn(List.of());

        ApiException exception = assertThrows(
                ApiException.class, () -> ownershipService.requireAnotherOwner(doc, creatorId, "last owner"));

        assertEquals(ErrorCode.CONFLICT, exception.getErrorCode());
        assertEquals("last owner", exception.getMessage());
    }
}
