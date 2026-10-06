package com.nextdocs.api.document.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.repository.DocumentRepository;
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

    private PermissionService permissionService;

    @BeforeEach
    void setUp() {
        permissionService = new PermissionService(documentRepository);
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
        User owner = User.builder().id(userId).build();
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
    void requireSharingAdminAccess_noTrashAccess_throwsNotFound() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document doc = Document.builder().id(documentId).build();

        when(documentRepository.findById(documentId)).thenReturn(Optional.of(doc));
        when(documentRepository.resolveTrashAccess(userId, documentId)).thenReturn(null);

        ApiException exception =
                assertThrows(ApiException.class, () -> permissionService.requireSharingAdminAccess(userId, documentId));
        assertEquals(ErrorCode.NOT_FOUND, exception.getErrorCode());
    }

    @Test
    void requireSharingAdminAccess_notOwnerLevel_throwsForbidden() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document doc = Document.builder().id(documentId).build();

        when(documentRepository.findById(documentId)).thenReturn(Optional.of(doc));
        when(documentRepository.resolveTrashAccess(userId, documentId)).thenReturn("EDIT");

        ApiException exception =
                assertThrows(ApiException.class, () -> permissionService.requireSharingAdminAccess(userId, documentId));
        assertEquals(ErrorCode.FORBIDDEN, exception.getErrorCode());
    }

    @Test
    void requireSharingAdminAccess_hasOwnerAccess_returnsDocument() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document doc = Document.builder().id(documentId).build();

        when(documentRepository.findById(documentId)).thenReturn(Optional.of(doc));
        when(documentRepository.resolveTrashAccess(userId, documentId)).thenReturn("OWNER");

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
}
