package com.nextdocs.api.document.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.repository.DocumentRepository;
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
    void requireOwnerAccessIncludingTrash_trashedDocumentOwned_returnsDocument() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        User owner = User.builder().id(userId).build();
        Document trashed = Document.builder()
                .id(documentId)
                .user(owner)
                .deletedAt(java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC))
                .build();

        when(documentRepository.findByIdAndUser_Id(documentId, userId)).thenReturn(Optional.of(trashed));

        Document result = permissionService.requireOwnerAccessIncludingTrash(userId, documentId);

        assertEquals(trashed, result);
    }

    @Test
    void requireOwnerAccessIncludingTrash_notOwner_throwsNotFound() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        when(documentRepository.findByIdAndUser_Id(documentId, userId)).thenReturn(Optional.empty());

        ApiException exception = assertThrows(
                ApiException.class, () -> permissionService.requireOwnerAccessIncludingTrash(userId, documentId));
        assertEquals(ErrorCode.NOT_FOUND, exception.getErrorCode());
    }

    @Test
    void requireReadAccessOrTrashOwner_activeWithAccess_returnsDocument() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document active = Document.builder().id(documentId).build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(active));
        when(documentRepository.resolveEffectiveAccess(userId, documentId)).thenReturn("VIEW");

        Document result = permissionService.requireReadAccessOrTrashOwner(userId, documentId);

        assertEquals(active, result);
    }

    @Test
    void requireReadAccessOrTrashOwner_activeWithoutAccess_throwsNotFound() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document active = Document.builder().id(documentId).build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(active));
        when(documentRepository.resolveEffectiveAccess(userId, documentId)).thenReturn(null);

        ApiException exception = assertThrows(
                ApiException.class, () -> permissionService.requireReadAccessOrTrashOwner(userId, documentId));
        assertEquals(ErrorCode.NOT_FOUND, exception.getErrorCode());
    }

    @Test
    void requireReadAccessOrTrashOwner_trashedOwnedByCaller_returnsDocument() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        User owner = User.builder().id(userId).build();
        Document trashed = Document.builder()
                .id(documentId)
                .user(owner)
                .deletedAt(java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC))
                .build();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.empty());
        when(documentRepository.findByIdAndUser_Id(documentId, userId)).thenReturn(Optional.of(trashed));

        Document result = permissionService.requireReadAccessOrTrashOwner(userId, documentId);

        assertEquals(trashed, result);
    }

    @Test
    void requireReadAccessOrTrashOwner_trashedNotOwner_throwsNotFound() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.empty());
        when(documentRepository.findByIdAndUser_Id(documentId, userId)).thenReturn(Optional.empty());

        ApiException exception = assertThrows(
                ApiException.class, () -> permissionService.requireReadAccessOrTrashOwner(userId, documentId));
        assertEquals(ErrorCode.NOT_FOUND, exception.getErrorCode());
    }
}
