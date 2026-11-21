package com.nextdocs.api.document.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.dto.response.AccessExplainResponse;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.repository.AccessGrantRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.space.entity.Space;
import com.nextdocs.api.space.service.SpaceAccessService;
import com.nextdocs.api.space.service.SpaceAccessService.SpaceContext;
import com.nextdocs.api.user.entity.User;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class PermissionServiceTest {

    @Mock
    private DocumentRepository documentRepository;

    @Mock
    private AccessGrantRepository accessGrantRepository;

    @Mock
    private SpaceAccessService spaceAccessService;

    private PermissionService permissionService;

    @BeforeEach
    void setUp() {
        permissionService = new PermissionService(documentRepository, accessGrantRepository, spaceAccessService);
    }

    @Test
    void removeSpaceAudienceRules_delegatesToTheSubtreeDelete() {
        UUID rootId = UUID.randomUUID();

        permissionService.removeSpaceAudienceRules(rootId);

        verify(accessGrantRepository).deleteSpaceAudienceGrantsInSubtree(rootId);
    }

    @Test
    void resolveAccess_ownerOfDocument_returnsOwner() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        when(documentRepository.resolveEffectiveAccess(userId, documentId)).thenReturn("OWNER");

        DocumentAccessLevel level = permissionService.resolveAccess(userId, documentId);

        assertEquals(DocumentAccessLevel.OWNER, level);
    }

    @Test
    void resolveAccess_directCollaboratorWithEdit_returnsEdit() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        when(documentRepository.resolveEffectiveAccess(userId, documentId)).thenReturn("EDIT");

        DocumentAccessLevel level = permissionService.resolveAccess(userId, documentId);

        assertEquals(DocumentAccessLevel.EDIT, level);
    }

    @Test
    void resolveAccess_noGrantAnywhere_returnsNull() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        when(documentRepository.resolveEffectiveAccess(userId, documentId)).thenReturn(null);

        DocumentAccessLevel level = permissionService.resolveAccess(userId, documentId);

        assertNull(level);
    }

    @Test
    void resolveAccess_parentTrashedAndNoDirectGrant_returnsNull() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        // resolve_effective_access returns null because trashed parent is excluded
        when(documentRepository.resolveEffectiveAccess(userId, documentId)).thenReturn(null);

        DocumentAccessLevel level = permissionService.resolveAccess(userId, documentId);

        assertNull(level);
    }

    @Test
    void resolveAccessBatch_skipsNullIdsInsteadOfAbortingBatch() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        when(documentRepository.resolveEffectiveAccessBatch(userId, documentId.toString()))
                .thenReturn(List.<Object[]>of(new Object[] {documentId, "EDIT"}));

        java.util.Map<UUID, DocumentAccessLevel> levels =
                permissionService.resolveAccessBatch(userId, java.util.Arrays.asList(documentId, null));

        assertEquals(java.util.Map.of(documentId, DocumentAccessLevel.EDIT), levels);
        verify(documentRepository).resolveEffectiveAccessBatch(userId, documentId.toString());
    }

    @Test
    void resolveAccessBatch_allNullIds_returnsEmptyWithoutQuerying() {
        java.util.Map<UUID, DocumentAccessLevel> levels =
                permissionService.resolveAccessBatch(UUID.randomUUID(), java.util.Arrays.asList(null, null));

        assertTrue(levels.isEmpty());
        verifyNoInteractions(documentRepository);
    }

    @Test
    void resolveAccessBatch_splitsLargeIdSetsIntoChunks() {
        UUID userId = UUID.randomUUID();
        List<UUID> documentIds = java.util.stream.IntStream.range(0, 1001)
                .mapToObj(index -> UUID.randomUUID())
                .toList();
        when(documentRepository.resolveEffectiveAccessBatch(eq(userId), anyString()))
                .thenAnswer(invocation -> {
                    String joined = invocation.getArgument(1);
                    return List.<Object[]>of(new Object[] {UUID.fromString(joined.substring(0, 36)), "VIEW"});
                });

        java.util.Map<UUID, DocumentAccessLevel> levels = permissionService.resolveAccessBatch(userId, documentIds);

        org.mockito.ArgumentCaptor<String> batches = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(documentRepository, times(2)).resolveEffectiveAccessBatch(eq(userId), batches.capture());
        // One giant parameter would exceed the driver/planner comfort zone, and one
        // recursive CTE over 1000+ ids is the shape this chunking exists to avoid.
        assertEquals(1000, batches.getAllValues().get(0).split(",").length);
        assertEquals(1, batches.getAllValues().get(1).split(",").length);
        // Both chunks contribute; a chunked loop that dropped a result would lose one.
        assertEquals(java.util.Set.of(documentIds.get(0), documentIds.get(1000)), levels.keySet());
    }

    @Test
    void resolveAccessBatch_dropsLevelsTheCallerMayNotRead() {
        UUID userId = UUID.randomUUID();
        UUID readableId = UUID.randomUUID();
        UUID revokedId = UUID.randomUUID();
        UUID unresolvedId = UUID.randomUUID();
        when(documentRepository.resolveEffectiveAccessBatch(eq(userId), anyString()))
                .thenReturn(List.<Object[]>of(
                        new Object[] {readableId, "NO_ACCESS"},
                        new Object[] {readableId, "VIEW"},
                        new Object[] {revokedId, "NO_ACCESS"},
                        new Object[] {unresolvedId, null}));

        java.util.Map<UUID, DocumentAccessLevel> levels = permissionService.resolveAccessBatch(
                userId, java.util.Arrays.asList(readableId, revokedId, unresolvedId));

        // A breakpoint and an unresolved row must not reach a caller as a level: only
        // allowsRead passes, and the last readable row wins for a duplicated id.
        assertEquals(java.util.Map.of(readableId, DocumentAccessLevel.VIEW), levels);
    }

    @Test
    void resolvePublicAccessBatch_dropsLevelsNoReaderMayOpen() {
        UUID readableId = UUID.randomUUID();
        UUID blockedId = UUID.randomUUID();
        when(documentRepository.resolvePublicAccessBatch(anyString()))
                .thenReturn(List.<Object[]>of(
                        new Object[] {readableId, "COMMENT"},
                        new Object[] {blockedId, "NO_ACCESS"},
                        new Object[] {blockedId, null}));

        java.util.Map<UUID, DocumentAccessLevel> levels =
                permissionService.resolvePublicAccessBatch(java.util.Arrays.asList(readableId, blockedId));

        assertEquals(java.util.Map.of(readableId, DocumentAccessLevel.COMMENT), levels);
    }

    @Test
    void resolveTrashAccessBatch_dropsLevelsTheCallerMayNotRead() {
        UUID userId = UUID.randomUUID();
        UUID readableId = UUID.randomUUID();
        UUID revokedId = UUID.randomUUID();
        when(documentRepository.resolveTrashAccessBatch(eq(userId), anyString()))
                .thenReturn(
                        List.<Object[]>of(new Object[] {readableId, "EDIT"}, new Object[] {revokedId, "NO_ACCESS"}));

        java.util.Map<UUID, DocumentAccessLevel> levels =
                permissionService.resolveTrashAccessBatch(userId, java.util.Arrays.asList(readableId, revokedId));

        assertEquals(java.util.Map.of(readableId, DocumentAccessLevel.EDIT), levels);
    }

    @Test
    void resolvePublicAccessBatch_skipsNullIdsInsteadOfAbortingBatch() {
        UUID documentId = UUID.randomUUID();
        when(documentRepository.resolvePublicAccessBatch(documentId.toString()))
                .thenReturn(List.<Object[]>of(new Object[] {documentId, "VIEW"}));

        java.util.Map<UUID, DocumentAccessLevel> levels =
                permissionService.resolvePublicAccessBatch(java.util.Arrays.asList(documentId, null));

        assertEquals(java.util.Map.of(documentId, DocumentAccessLevel.VIEW), levels);
        verify(documentRepository).resolvePublicAccessBatch(documentId.toString());
    }

    @Test
    void resolvePublicAccessBatch_allNullIds_returnsEmptyWithoutQuerying() {
        java.util.Map<UUID, DocumentAccessLevel> levels =
                permissionService.resolvePublicAccessBatch(java.util.Arrays.asList(null, null));

        assertTrue(levels.isEmpty());
        verifyNoInteractions(documentRepository);
    }

    @Test
    void requireReadAccess_noAccess_throwsNotFound() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document doc = Document.builder().id(documentId).build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(doc));
        when(documentRepository.resolveEffectiveAccess(userId, documentId)).thenReturn(null);

        ApiException exception =
                assertThrows(ApiException.class, () -> permissionService.requireReadAccess(userId, documentId));
        assertEquals(ErrorCode.NOT_FOUND, exception.getErrorCode());
    }

    @Test
    void requireReadAccess_hasAccess_returnsDocument() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document doc = Document.builder().id(documentId).build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(doc));
        when(documentRepository.resolveEffectiveAccess(userId, documentId)).thenReturn("VIEW");

        Document result = permissionService.requireReadAccess(userId, documentId);

        assertEquals(doc, result);
    }

    @Test
    void requireEditAccess_viewOnly_throwsForbidden() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document doc = Document.builder().id(documentId).build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(doc));
        when(documentRepository.resolveEffectiveAccess(userId, documentId)).thenReturn("VIEW");

        ApiException exception =
                assertThrows(ApiException.class, () -> permissionService.requireEditAccess(userId, documentId));
        assertEquals(ErrorCode.FORBIDDEN, exception.getErrorCode());
    }

    @Test
    void requireEditAccess_hasEdit_returnsDocument() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document doc = Document.builder().id(documentId).build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(doc));
        when(documentRepository.resolveEffectiveAccess(userId, documentId)).thenReturn("EDIT");

        Document result = permissionService.requireEditAccess(userId, documentId);

        assertEquals(doc, result);
    }

    @Test
    void requireOwnerAccess_notOwner_throwsNotFound() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        when(documentRepository.findByIdAndUser_IdAndDeletedAtIsNull(documentId, userId))
                .thenReturn(Optional.empty());

        ApiException exception =
                assertThrows(ApiException.class, () -> permissionService.requireOwnerAccess(userId, documentId));
        assertEquals(ErrorCode.NOT_FOUND, exception.getErrorCode());
    }

    @Test
    void requireOwnerAccess_isOwner_returnsDocument() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        User owner = User.builder().id(userId).passwordHash("$2a$12$hash").build();
        Document doc = Document.builder().id(documentId).user(owner).build();

        when(documentRepository.findByIdAndUser_IdAndDeletedAtIsNull(documentId, userId))
                .thenReturn(Optional.of(doc));

        Document result = permissionService.requireOwnerAccess(userId, documentId);

        assertEquals(doc, result);
    }

    @Test
    void resolveTrashAccess_collaboratorWithEdit_returnsEdit() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        when(documentRepository.resolveTrashAccess(userId, documentId)).thenReturn("EDIT");

        DocumentAccessLevel level = permissionService.resolveTrashAccess(userId, documentId);

        assertEquals(DocumentAccessLevel.EDIT, level);
    }

    @Test
    void resolveTrashAccess_noGrantAnywhere_returnsNull() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        when(documentRepository.resolveTrashAccess(userId, documentId)).thenReturn(null);

        assertNull(permissionService.resolveTrashAccess(userId, documentId));
    }

    @Test
    void requireTrashEditAccess_missingDocument_throwsNotFound() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        when(documentRepository.findById(documentId)).thenReturn(Optional.empty());

        ApiException exception =
                assertThrows(ApiException.class, () -> permissionService.requireTrashEditAccess(userId, documentId));
        assertEquals(ErrorCode.NOT_FOUND, exception.getErrorCode());
    }

    @Test
    void requireTrashEditAccess_noAccess_throwsNotFound() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document doc = Document.builder().id(documentId).build();

        when(documentRepository.findById(documentId)).thenReturn(Optional.of(doc));
        when(documentRepository.resolveTrashAccess(userId, documentId)).thenReturn(null);

        ApiException exception =
                assertThrows(ApiException.class, () -> permissionService.requireTrashEditAccess(userId, documentId));
        assertEquals(ErrorCode.NOT_FOUND, exception.getErrorCode());
    }

    @Test
    void requireTrashEditAccess_viewOnly_throwsForbidden() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document doc = Document.builder().id(documentId).build();

        when(documentRepository.findById(documentId)).thenReturn(Optional.of(doc));
        when(documentRepository.resolveTrashAccess(userId, documentId)).thenReturn("VIEW");

        ApiException exception =
                assertThrows(ApiException.class, () -> permissionService.requireTrashEditAccess(userId, documentId));
        assertEquals(ErrorCode.FORBIDDEN, exception.getErrorCode());
    }

    @Test
    void requireTrashEditAccess_hasEdit_returnsDocument() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document doc = Document.builder().id(documentId).build();

        when(documentRepository.findById(documentId)).thenReturn(Optional.of(doc));
        when(documentRepository.resolveTrashAccess(userId, documentId)).thenReturn("EDIT");

        Document result = permissionService.requireTrashEditAccess(userId, documentId);

        assertEquals(doc, result);
    }

    @Test
    void requireSharingAdminAccess_notFound_throwsNotFound() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        when(documentRepository.findById(documentId)).thenReturn(Optional.empty());

        ApiException exception =
                assertThrows(ApiException.class, () -> permissionService.requireSharingAdminAccess(userId, documentId));
        assertEquals(ErrorCode.NOT_FOUND, exception.getErrorCode());
    }

    @Test
    void requireSharingAdminAccess_noAccess_throwsNotFound() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document doc = Document.builder().id(documentId).build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(doc));
        when(documentRepository.resolveEffectiveAccess(userId, documentId)).thenReturn(null);

        ApiException exception =
                assertThrows(ApiException.class, () -> permissionService.requireSharingAdminAccess(userId, documentId));
        assertEquals(ErrorCode.NOT_FOUND, exception.getErrorCode());
    }

    @Test
    void requireSharingAdminAccess_notOwnerLevel_throwsForbidden() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document doc = Document.builder().id(documentId).build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(doc));
        when(documentRepository.resolveEffectiveAccess(userId, documentId)).thenReturn("EDIT");

        ApiException exception =
                assertThrows(ApiException.class, () -> permissionService.requireSharingAdminAccess(userId, documentId));
        assertEquals(ErrorCode.FORBIDDEN, exception.getErrorCode());
    }

    @Test
    void requireSharingAdminAccess_hasOwnerAccess_returnsDocument() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document doc = Document.builder().id(documentId).build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(doc));
        when(documentRepository.resolveEffectiveAccess(userId, documentId)).thenReturn("OWNER");

        Document result = permissionService.requireSharingAdminAccess(userId, documentId);

        assertEquals(doc, result);
    }

    @Test
    void requireSharingAdminAccess_trashedDocumentWithTrashOwnerAccess_returnsDocument() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document trashed = Document.builder()
                .id(documentId)
                .deletedAt(java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC))
                .build();

        when(documentRepository.findById(documentId)).thenReturn(Optional.of(trashed));
        when(documentRepository.resolveTrashAccess(userId, documentId)).thenReturn("OWNER");

        Document result = permissionService.requireSharingAdminAccess(userId, documentId);

        assertEquals(trashed, result);
    }

    @Test
    void requireSharingAdminAccess_archivedSpaceReadable_throwsConflictInsteadOfNotFound() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        // A child does not repeat the space: the gate has to walk to the root anchor.
        Space archivedSpace = Space.builder()
                .id(UUID.randomUUID())
                .name("Archived")
                .archivedAt(java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC))
                .build();
        Document archivedRoot =
                Document.builder().id(UUID.randomUUID()).space(archivedSpace).build();
        Document doc = Document.builder().id(documentId).parent(archivedRoot).build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(doc));
        when(spaceAccessService.requireActiveAdministration(userId, archivedSpace.getId()))
                .thenThrow(new ApiException(ErrorCode.CONFLICT));

        ApiException exception =
                assertThrows(ApiException.class, () -> permissionService.requireSharingAdminAccess(userId, documentId));
        assertEquals(ErrorCode.CONFLICT, exception.getErrorCode());
        // The space gate answers before the page access resolution can mask the archive.
        verify(documentRepository, never()).resolveTrashAccess(any(), any());
        verify(documentRepository, never()).resolveEffectiveAccess(any(), any());
    }

    @Test
    void requireSharingAdminAccess_archivedSpaceWithoutReadAccess_throwsNotFound() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Space archivedSpace = Space.builder()
                .id(UUID.randomUUID())
                .name("Archived")
                .archivedAt(java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC))
                .build();
        Document archivedRoot =
                Document.builder().id(UUID.randomUUID()).space(archivedSpace).build();
        Document doc = Document.builder().id(documentId).parent(archivedRoot).build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(doc));
        when(spaceAccessService.requireActiveAdministration(userId, archivedSpace.getId()))
                .thenThrow(new ApiException(ErrorCode.NOT_FOUND));

        ApiException exception =
                assertThrows(ApiException.class, () -> permissionService.requireSharingAdminAccess(userId, documentId));
        assertEquals(ErrorCode.NOT_FOUND, exception.getErrorCode());
        // No standing means the caller never learns whether the page still exists.
        verify(documentRepository, never()).resolveTrashAccess(any(), any());
    }

    @Test
    void requireSharingAdminAccess_spacePageWithPageOwner_returnsDocumentWithoutSpaceAdministration() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Space space = Space.builder().id(UUID.randomUUID()).name("Team").build();
        Document root = Document.builder().id(UUID.randomUUID()).space(space).build();
        Document doc = Document.builder().id(documentId).parent(root).build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(doc));
        when(documentRepository.resolveEffectiveAccess(userId, documentId)).thenReturn("OWNER");

        Document result = permissionService.requireSharingAdminAccess(userId, documentId);

        assertEquals(doc, result);
        verify(spaceAccessService, never()).requireActiveAdministration(userId, space.getId());
    }

    @Test
    void requireSharingAdminAccess_spacePageWithoutPageOwner_fallsBackToSpaceAdministration() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Space space = Space.builder().id(UUID.randomUUID()).name("Team").build();
        Document root = Document.builder().id(UUID.randomUUID()).space(space).build();
        Document doc = Document.builder().id(documentId).parent(root).build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(doc));
        when(documentRepository.resolveEffectiveAccess(userId, documentId)).thenReturn("EDIT");

        Document result = permissionService.requireSharingAdminAccess(userId, documentId);

        assertEquals(doc, result);
        verify(spaceAccessService).requireActiveAdministration(userId, space.getId());
    }

    @Test
    void requireReadAccessIncludingTrash_activeWithAccess_returnsDocument() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document active = Document.builder().id(documentId).build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(active));
        when(documentRepository.resolveEffectiveAccess(userId, documentId)).thenReturn("VIEW");

        Document result = permissionService.requireReadAccessIncludingTrash(userId, documentId);

        assertEquals(active, result);
    }

    @Test
    void requireReadAccessIncludingTrash_activeWithoutAccess_throwsNotFound() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document active = Document.builder().id(documentId).build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(active));
        when(documentRepository.resolveEffectiveAccess(userId, documentId)).thenReturn(null);

        ApiException exception = assertThrows(
                ApiException.class, () -> permissionService.requireReadAccessIncludingTrash(userId, documentId));
        assertEquals(ErrorCode.NOT_FOUND, exception.getErrorCode());
    }

    @Test
    void requireReadAccessIncludingTrash_trashedWithReadAccess_returnsDocument() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document trashed = Document.builder()
                .id(documentId)
                .deletedAt(java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC))
                .build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.empty());
        when(documentRepository.findById(documentId)).thenReturn(Optional.of(trashed));
        when(documentRepository.resolveTrashAccess(userId, documentId)).thenReturn("VIEW");

        Document result = permissionService.requireReadAccessIncludingTrash(userId, documentId);

        assertEquals(trashed, result);
    }

    @Test
    void requireReadAccessIncludingTrash_trashedWithoutAccess_throwsNotFound() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document trashed = Document.builder()
                .id(documentId)
                .deletedAt(java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC))
                .build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.empty());
        when(documentRepository.findById(documentId)).thenReturn(Optional.of(trashed));
        when(documentRepository.resolveTrashAccess(userId, documentId)).thenReturn(null);

        ApiException exception = assertThrows(
                ApiException.class, () -> permissionService.requireReadAccessIncludingTrash(userId, documentId));
        assertEquals(ErrorCode.NOT_FOUND, exception.getErrorCode());
    }

    @Test
    void requireReadAccessIncludingTrash_trashedNotFound_throwsNotFound() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.empty());
        when(documentRepository.findById(documentId)).thenReturn(Optional.empty());

        ApiException exception = assertThrows(
                ApiException.class, () -> permissionService.requireReadAccessIncludingTrash(userId, documentId));
        assertEquals(ErrorCode.NOT_FOUND, exception.getErrorCode());
    }

    @Test
    void explainAccess_linkRaisesADeniedIdentity() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        when(documentRepository.findById(documentId))
                .thenReturn(Optional.of(Document.builder().id(documentId).build()));
        when(documentRepository.resolveIdentityAccess(userId, documentId, "ACTIVE"))
                .thenReturn("NO_ACCESS");
        when(documentRepository.resolvePublicAccess(documentId)).thenReturn("VIEW");

        AccessExplainResponse response = permissionService.explainAccess(userId, documentId);

        assertEquals("VIEW", response.effectiveLevel());
        assertEquals("NO_ACCESS", response.identityLevel());
        assertEquals("VIEW", response.linkLevel());
        assertEquals("LINK", response.channel());
        assertFalse(response.denied());
        assertTrue(response.identityDenied());
        verify(documentRepository).resolveIdentityAccess(userId, documentId, "ACTIVE");
        verify(documentRepository, never()).resolveEffectiveAccess(userId, documentId);
    }

    @Test
    void explainAccess_identityOutranksTheLink() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        when(documentRepository.findById(documentId))
                .thenReturn(Optional.of(Document.builder().id(documentId).build()));
        when(documentRepository.resolveIdentityAccess(userId, documentId, "ACTIVE"))
                .thenReturn("EDIT");
        when(documentRepository.resolvePublicAccess(documentId)).thenReturn("VIEW");

        AccessExplainResponse response = permissionService.explainAccess(userId, documentId);

        assertEquals("EDIT", response.effectiveLevel());
        assertEquals("IDENTITY", response.channel());
        assertFalse(response.denied());
        assertFalse(response.identityDenied());
    }

    @Test
    void explainAccess_noChannelMeansDenied() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        when(documentRepository.findById(documentId))
                .thenReturn(Optional.of(Document.builder().id(documentId).build()));
        when(documentRepository.resolveIdentityAccess(userId, documentId, "ACTIVE"))
                .thenReturn(null);
        when(documentRepository.resolvePublicAccess(documentId)).thenReturn(null);

        AccessExplainResponse response = permissionService.explainAccess(userId, documentId);

        assertEquals("NO_ACCESS", response.effectiveLevel());
        assertNull(response.channel());
        assertTrue(response.denied());
        assertFalse(response.identityDenied());
    }

    @Test
    void explainAccess_usesTrashIdentityScopeAndDoesNotCountLinkAccess() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = Document.builder()
                .id(documentId)
                .deletedAt(OffsetDateTime.now())
                .build();
        when(documentRepository.findById(documentId)).thenReturn(Optional.of(document));
        when(documentRepository.resolveIdentityAccess(userId, documentId, "TRASH"))
                .thenReturn("OWNER");

        AccessExplainResponse response = permissionService.explainAccess(userId, documentId);

        assertEquals("OWNER", response.identityLevel());
        assertEquals("OWNER", response.effectiveLevel());
        assertEquals("IDENTITY", response.channel());
        assertNull(response.linkLevel());
        verify(documentRepository, never()).resolvePublicAccess(documentId);
    }

    @Test
    void requireCommentAccess_commentLevel_returnsDocumentAndLevel() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document doc = Document.builder().id(documentId).build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(doc));
        when(documentRepository.resolveEffectiveAccess(userId, documentId)).thenReturn("COMMENT");

        PermissionService.DocumentCommentAccess access = permissionService.requireCommentAccess(userId, documentId);

        assertEquals(doc, access.document());
        assertEquals(DocumentAccessLevel.COMMENT, access.accessLevel());
        assertFalse(access.canEdit());
    }

    @Test
    void requireCommentAccess_viewOnly_throwsForbidden() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId))
                .thenReturn(Optional.of(Document.builder().id(documentId).build()));
        when(documentRepository.resolveEffectiveAccess(userId, documentId)).thenReturn("VIEW");

        ApiException exception =
                assertThrows(ApiException.class, () -> permissionService.requireCommentAccess(userId, documentId));
        assertEquals(ErrorCode.FORBIDDEN, exception.getErrorCode());
    }

    @Test
    void requireCommentAccess_noAccess_throwsNotFound() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId))
                .thenReturn(Optional.of(Document.builder().id(documentId).build()));
        when(documentRepository.resolveEffectiveAccess(userId, documentId)).thenReturn(null);

        ApiException exception =
                assertThrows(ApiException.class, () -> permissionService.requireCommentAccess(userId, documentId));
        assertEquals(ErrorCode.NOT_FOUND, exception.getErrorCode());
    }

    @Test
    void requireIdentityGrantForRoster_ownerOfStandalonePage_passes() {
        UUID ownerId = UUID.randomUUID();
        Document doc = Document.builder()
                .id(UUID.randomUUID())
                .user(User.builder().id(ownerId).passwordHash("$2a$12$hash").build())
                .build();

        permissionService.requireIdentityGrantForRoster(ownerId, doc);

        verifyNoInteractions(accessGrantRepository, spaceAccessService);
    }

    @Test
    void requireIdentityGrantForRoster_identityGrantedReader_passes() {
        UUID memberId = UUID.randomUUID();
        Document doc = Document.builder()
                .id(UUID.randomUUID())
                .user(User.builder()
                        .id(UUID.randomUUID())
                        .passwordHash("$2a$12$hash")
                        .build())
                .build();
        when(accessGrantRepository.hasPositiveIdentityGrant(memberId, doc.getId()))
                .thenReturn(true);

        permissionService.requireIdentityGrantForRoster(memberId, doc);
    }

    @Test
    void requireIdentityGrantForRoster_linkOnlyReader_throwsNotFound() {
        UUID linkOnlyId = UUID.randomUUID();
        Document doc = Document.builder()
                .id(UUID.randomUUID())
                .user(User.builder()
                        .id(UUID.randomUUID())
                        .passwordHash("$2a$12$hash")
                        .build())
                .build();
        when(accessGrantRepository.hasPositiveIdentityGrant(linkOnlyId, doc.getId()))
                .thenReturn(false);

        ApiException exception = assertThrows(
                ApiException.class, () -> permissionService.requireIdentityGrantForRoster(linkOnlyId, doc));

        assertEquals(ErrorCode.NOT_FOUND, exception.getErrorCode());
    }

    @Test
    void requireIdentityGrantForRoster_spaceMemberWithoutPageGrant_passes() {
        UUID memberId = UUID.randomUUID();
        UUID spaceId = UUID.randomUUID();
        Space space = Space.builder().id(spaceId).name("Engineering").build();
        Document doc = Document.builder()
                .id(UUID.randomUUID())
                .space(space)
                .user(User.builder()
                        .id(UUID.randomUUID())
                        .passwordHash("$2a$12$hash")
                        .build())
                .build();
        when(accessGrantRepository.hasPositiveIdentityGrant(memberId, doc.getId()))
                .thenReturn(false);
        when(spaceAccessService.load(memberId, spaceId))
                .thenReturn(new SpaceContext(space, WorkspaceRole.MEMBER, DocumentAccessLevel.VIEW));

        permissionService.requireIdentityGrantForRoster(memberId, doc);
    }

    @Test
    void requireIdentityGrantForRoster_spaceAdminWithoutContentAccess_passes() {
        UUID adminId = UUID.randomUUID();
        UUID spaceId = UUID.randomUUID();
        Space space = Space.builder().id(spaceId).name("Engineering").build();
        Document doc = Document.builder()
                .id(UUID.randomUUID())
                .space(space)
                .user(User.builder()
                        .id(UUID.randomUUID())
                        .passwordHash("$2a$12$hash")
                        .build())
                .build();
        when(accessGrantRepository.hasPositiveIdentityGrant(adminId, doc.getId()))
                .thenReturn(false);
        // Sharing is an administrator's call, so an admin with no content level still
        // sees the roster.
        when(spaceAccessService.load(adminId, spaceId)).thenReturn(new SpaceContext(space, WorkspaceRole.ADMIN, null));

        permissionService.requireIdentityGrantForRoster(adminId, doc);
    }

    @Test
    void requireIdentityGrantForRoster_inaccessibleSpace_throwsNotFound() {
        UUID outsiderId = UUID.randomUUID();
        UUID spaceId = UUID.randomUUID();
        Space space = Space.builder().id(spaceId).name("Engineering").build();
        Document doc = Document.builder()
                .id(UUID.randomUUID())
                .space(space)
                .user(User.builder()
                        .id(UUID.randomUUID())
                        .passwordHash("$2a$12$hash")
                        .build())
                .build();
        when(accessGrantRepository.hasPositiveIdentityGrant(outsiderId, doc.getId()))
                .thenReturn(false);
        // No membership and no content level: the space grants nothing.
        when(spaceAccessService.load(outsiderId, spaceId))
                .thenReturn(new SpaceContext(space, WorkspaceRole.MEMBER, null));

        ApiException exception = assertThrows(
                ApiException.class, () -> permissionService.requireIdentityGrantForRoster(outsiderId, doc));

        assertEquals(ErrorCode.NOT_FOUND, exception.getErrorCode());
    }

    @Test
    void requireIdentityGrantForRoster_missingSpaceMembership_throwsNotFound() {
        UUID outsiderId = UUID.randomUUID();
        UUID spaceId = UUID.randomUUID();
        Space space = Space.builder().id(spaceId).name("Engineering").build();
        Document doc = Document.builder()
                .id(UUID.randomUUID())
                .space(space)
                .user(User.builder()
                        .id(UUID.randomUUID())
                        .passwordHash("$2a$12$hash")
                        .build())
                .build();
        when(accessGrantRepository.hasPositiveIdentityGrant(outsiderId, doc.getId()))
                .thenReturn(false);
        // A vanished space membership is "no grant", not a server fault.
        when(spaceAccessService.load(outsiderId, spaceId)).thenThrow(new ApiException(ErrorCode.NOT_FOUND));

        ApiException exception = assertThrows(
                ApiException.class, () -> permissionService.requireIdentityGrantForRoster(outsiderId, doc));

        assertEquals(ErrorCode.NOT_FOUND, exception.getErrorCode());
    }

    @Test
    void requireIdentityGrantForRoster_unresolvableSpace_throwsNotFound() {
        UUID outsiderId = UUID.randomUUID();
        UUID spaceId = UUID.randomUUID();
        Space space = Space.builder().id(spaceId).name("Engineering").build();
        Document doc = Document.builder()
                .id(UUID.randomUUID())
                .space(space)
                .user(User.builder()
                        .id(UUID.randomUUID())
                        .passwordHash("$2a$12$hash")
                        .build())
                .build();
        when(accessGrantRepository.hasPositiveIdentityGrant(outsiderId, doc.getId()))
                .thenReturn(false);
        when(spaceAccessService.load(outsiderId, spaceId)).thenReturn(null);

        ApiException exception = assertThrows(
                ApiException.class, () -> permissionService.requireIdentityGrantForRoster(outsiderId, doc));

        assertEquals(ErrorCode.NOT_FOUND, exception.getErrorCode());
    }

    @Test
    void requireIdentityGrantForRoster_spaceLookupFailureOtherThanNotFound_propagates() {
        UUID memberId = UUID.randomUUID();
        UUID spaceId = UUID.randomUUID();
        Space space = Space.builder().id(spaceId).name("Engineering").build();
        Document doc = Document.builder()
                .id(UUID.randomUUID())
                .space(space)
                .user(User.builder()
                        .id(UUID.randomUUID())
                        .passwordHash("$2a$12$hash")
                        .build())
                .build();
        when(accessGrantRepository.hasPositiveIdentityGrant(memberId, doc.getId()))
                .thenReturn(false);
        // Only NOT_FOUND means "no space grant"; other failures are real faults and must
        // not be masked as a hidden roster.
        when(spaceAccessService.load(memberId, spaceId)).thenThrow(new ApiException(ErrorCode.FORBIDDEN));

        ApiException exception =
                assertThrows(ApiException.class, () -> permissionService.requireIdentityGrantForRoster(memberId, doc));

        assertEquals(ErrorCode.FORBIDDEN, exception.getErrorCode());
    }

    @Test
    void requirePublicCommentAccess_commentLink_returnsDocumentAndLevel() {
        UUID documentId = UUID.randomUUID();
        Document doc = Document.builder().id(documentId).build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(doc));
        when(documentRepository.resolvePublicAccess(documentId)).thenReturn("COMMENT");

        PermissionService.DocumentCommentAccess access = permissionService.requirePublicCommentAccess(documentId);

        assertEquals(doc, access.document());
        assertEquals(DocumentAccessLevel.COMMENT, access.accessLevel());
    }

    @Test
    void requirePublicCommentAccess_viewLink_throwsForbidden() {
        UUID documentId = UUID.randomUUID();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId))
                .thenReturn(Optional.of(Document.builder().id(documentId).build()));
        when(documentRepository.resolvePublicAccess(documentId)).thenReturn("VIEW");

        ApiException exception =
                assertThrows(ApiException.class, () -> permissionService.requirePublicCommentAccess(documentId));
        assertEquals(ErrorCode.FORBIDDEN, exception.getErrorCode());
    }
}
