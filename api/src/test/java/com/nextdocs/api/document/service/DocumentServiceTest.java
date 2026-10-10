package com.nextdocs.api.document.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.nextdocs.api.attachment.service.AttachmentService;
import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.config.DocumentProperties;
import com.nextdocs.api.document.dto.request.DocumentCreateRequest;
import com.nextdocs.api.document.dto.request.DocumentUpdateRequest;
import com.nextdocs.api.document.dto.response.DocumentBreadcrumbResponse;
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
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;

@ExtendWith(MockitoExtension.class)
class DocumentServiceTest {

    @Mock
    private DocumentRepository documentRepository;

    @Mock
    private UserRepository userRepository;

    @Mock
    private DocumentCollaboratorRepository collaboratorRepository;

    @Mock
    private UserDocumentOrderRepository userDocumentOrderRepository;

    @Mock
    private PermissionService permissionService;

    @Mock
    private DocumentListQueryHelper queryHelper;

    @Mock
    private AttachmentService attachmentService;

    private DocumentProperties documentProperties;

    private DocumentService documentService;

    @BeforeEach
    void setUp() {
        documentProperties = new DocumentProperties();
        documentProperties.setTrashRetentionDays(30);
        documentService = new DocumentService(
                documentRepository,
                collaboratorRepository,
                userDocumentOrderRepository,
                userRepository,
                documentProperties,
                permissionService,
                queryHelper,
                attachmentService);
    }

    @Test
    void purgeExpiredTrash_purgesExpiredSubtreesBatchByBatch() {
        OffsetDateTime asOf = OffsetDateTime.of(2025, 6, 15, 12, 0, 0, 0, ZoneOffset.UTC);
        UUID rootId = UUID.randomUUID();
        UUID childId = UUID.randomUUID();
        when(documentRepository.findExpiredTrashRoots(any(), any())).thenReturn(List.of(rootId), List.of());
        when(documentRepository.findIdsByParent_IdIn(List.of(rootId))).thenReturn(List.of(childId));
        when(documentRepository.findIdsByParent_IdIn(List.of(childId))).thenReturn(List.of());
        when(attachmentService.findStorageKeysForDocuments(anyCollection())).thenReturn(List.of("doc/file"));

        int purged = documentService.purgeExpiredTrash(asOf);

        // The whole subtree counts, not just the expired root.
        assertEquals(2, purged);
        ArgumentCaptor<OffsetDateTime> cutoff = ArgumentCaptor.forClass(OffsetDateTime.class);
        verify(documentRepository, atLeastOnce()).findExpiredTrashRoots(cutoff.capture(), any());
        assertEquals(OffsetDateTime.of(2025, 5, 16, 12, 0, 0, 0, ZoneOffset.UTC), cutoff.getValue());
    }

    @Test
    void purgeExpiredTrash_removesAttachmentRowsAndSchedulesFileCleanupInOrder() {
        OffsetDateTime asOf = OffsetDateTime.of(2025, 6, 15, 12, 0, 0, 0, ZoneOffset.UTC);
        UUID rootId = UUID.randomUUID();
        when(documentRepository.findExpiredTrashRoots(any(), any())).thenReturn(List.of(rootId), List.of());
        when(documentRepository.findIdsByParent_IdIn(List.of(rootId))).thenReturn(List.of());
        when(attachmentService.findStorageKeysForDocuments(anyCollection())).thenReturn(List.of("doc/file"));

        int purged = documentService.purgeExpiredTrash(asOf);

        assertEquals(1, purged);
        // Keys and per-user sizes must be read before the rows disappear, and the stored
        // bytes only once the transaction that removed their rows has committed.
        InOrder inOrder = inOrder(attachmentService, documentRepository);
        inOrder.verify(attachmentService).findStorageKeysForDocuments(anyCollection());
        inOrder.verify(attachmentService).releaseQuotaForDocuments(anyCollection());
        inOrder.verify(attachmentService).deleteForDocuments(anyCollection());
        inOrder.verify(documentRepository).deleteByIdIn(List.of(rootId));
        inOrder.verify(attachmentService).deleteStoredFilesAfterCommit(List.of("doc/file"));
    }

    @Test
    void purgeExpiredTrash_batchFailure_retriesIndividuallyAndSkipsFailingRoot() {
        OffsetDateTime asOf = OffsetDateTime.of(2025, 6, 15, 12, 0, 0, 0, ZoneOffset.UTC);
        UUID failingRoot = UUID.randomUUID();
        UUID healthyRoot = UUID.randomUUID();
        // Second fetch still returns the skipped root, proving the filter breaks the loop
        // instead of spinning on a root that cannot be deleted.
        when(documentRepository.findExpiredTrashRoots(any(), any()))
                .thenReturn(List.of(failingRoot, healthyRoot), List.of(failingRoot));
        when(documentRepository.findIdsByParent_IdIn(any())).thenAnswer(invocation -> {
            Collection<UUID> ids = invocation.getArgument(0);
            if (ids.contains(failingRoot)) {
                throw new RuntimeException("walk failed");
            }
            return List.of();
        });
        when(attachmentService.findStorageKeysForDocuments(anyCollection())).thenReturn(List.of());

        int purged = documentService.purgeExpiredTrash(asOf);

        assertEquals(1, purged);
        verify(documentRepository).deleteByIdIn(List.of(healthyRoot));
        verify(documentRepository, never()).deleteByIdIn(List.of(failingRoot));
    }

    @Test
    @SuppressWarnings("unchecked")
    void delete_permanent_removesAttachmentsForDocumentAndDescendants() {
        UUID ownerId = UUID.randomUUID();
        UUID parentDocId = UUID.randomUUID();
        UUID childDocId = UUID.randomUUID();
        User owner = User.builder().id(ownerId).build();
        Document parentDoc = Document.builder()
                .id(parentDocId)
                .user(owner)
                .title("Parent Doc")
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();
        Document childDoc = Document.builder()
                .id(childDocId)
                .user(owner)
                .parent(parentDoc)
                .title("Child Doc")
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(permissionService.requireTrashEditAccess(ownerId, parentDocId)).thenReturn(parentDoc);
        when(documentRepository.findIdsByParent_IdIn(List.of(parentDocId))).thenReturn(List.of(childDocId));
        when(documentRepository.findIdsByParent_IdIn(List.of(childDocId))).thenReturn(List.of());
        when(attachmentService.findStorageKeysForDocuments(anyCollection()))
                .thenReturn(List.of("parent/file", "child/file"));

        documentService.delete(ownerId, parentDocId, true);

        ArgumentCaptor<Collection<UUID>> documentsCaptor = ArgumentCaptor.forClass(Collection.class);
        // Collect keys and sizes, delete the attachment rows, then drop the documents
        // leaves-first — files only after the transaction commits.
        InOrder inOrder = inOrder(attachmentService, documentRepository);
        inOrder.verify(attachmentService).findStorageKeysForDocuments(documentsCaptor.capture());
        assertTrue(documentsCaptor.getValue().containsAll(List.of(parentDocId, childDocId)));
        inOrder.verify(attachmentService).releaseQuotaForDocuments(documentsCaptor.capture());
        assertTrue(documentsCaptor.getValue().containsAll(List.of(parentDocId, childDocId)));
        inOrder.verify(attachmentService).deleteForDocuments(documentsCaptor.capture());
        assertTrue(documentsCaptor.getValue().containsAll(List.of(parentDocId, childDocId)));
        inOrder.verify(documentRepository).deleteByIdIn(List.of(childDocId));
        inOrder.verify(documentRepository).deleteByIdIn(List.of(parentDocId));
        inOrder.verify(attachmentService).deleteStoredFilesAfterCommit(List.of("parent/file", "child/file"));
    }

    @Test
    void delete_permanent_leafDocumentWithoutChildren_collectsOnlyItsOwnAttachments() {
        UUID ownerId = UUID.randomUUID();
        UUID leafId = UUID.randomUUID();
        User owner = User.builder().id(ownerId).build();
        Document leaf = Document.builder()
                .id(leafId)
                .user(owner)
                .title("Leaf")
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(permissionService.requireTrashEditAccess(ownerId, leafId)).thenReturn(leaf);
        when(documentRepository.findIdsByParent_IdIn(List.of(leafId))).thenReturn(List.of());
        when(attachmentService.findStorageKeysForDocuments(List.of(leafId))).thenReturn(List.of());

        documentService.delete(ownerId, leafId, true);

        InOrder inOrder = inOrder(attachmentService, documentRepository);
        inOrder.verify(attachmentService).findStorageKeysForDocuments(List.of(leafId));
        inOrder.verify(attachmentService).deleteForDocuments(List.of(leafId));
        inOrder.verify(documentRepository).deleteByIdIn(List.of(leafId));
        // Zero keys must still flow through the after-commit cleanup, which no-ops on empty.
        inOrder.verify(attachmentService).deleteStoredFilesAfterCommit(List.of());
    }

    @Test
    @SuppressWarnings("unchecked")
    void delete_permanent_threeLevelNesting_collectsEveryLevelBeforeDeleting() {
        UUID ownerId = UUID.randomUUID();
        User owner = User.builder().id(ownerId).build();
        Document root = trashedDoc(owner, UUID.randomUUID(), "Root", null);
        Document child = trashedDoc(owner, UUID.randomUUID(), "Child", root);
        Document grandchild = trashedDoc(owner, UUID.randomUUID(), "Grandchild", child);

        when(permissionService.requireTrashEditAccess(ownerId, root.getId())).thenReturn(root);
        when(documentRepository.findIdsByParent_IdIn(List.of(root.getId()))).thenReturn(List.of(child.getId()));
        when(documentRepository.findIdsByParent_IdIn(List.of(child.getId()))).thenReturn(List.of(grandchild.getId()));
        when(documentRepository.findIdsByParent_IdIn(List.of(grandchild.getId())))
                .thenReturn(List.of());
        when(attachmentService.findStorageKeysForDocuments(anyCollection())).thenReturn(List.of("root/f"));

        documentService.delete(ownerId, root.getId(), true);

        ArgumentCaptor<Collection<UUID>> documentsCaptor = ArgumentCaptor.forClass(Collection.class);
        verify(attachmentService).findStorageKeysForDocuments(documentsCaptor.capture());
        assertTrue(documentsCaptor.getValue().containsAll(List.of(root.getId(), child.getId(), grandchild.getId())));
        // Leaves first: the grandchild row goes before its ancestors.
        InOrder inOrder = inOrder(documentRepository);
        inOrder.verify(documentRepository).deleteByIdIn(List.of(grandchild.getId()));
        inOrder.verify(documentRepository).deleteByIdIn(List.of(child.getId()));
        inOrder.verify(documentRepository).deleteByIdIn(List.of(root.getId()));
    }

    @Test
    void delete_permanent_attachmentRowDeleteFails_abortsBeforeRemovingDocuments() {
        UUID ownerId = UUID.randomUUID();
        UUID leafId = UUID.randomUUID();
        User owner = User.builder().id(ownerId).build();
        Document leaf = Document.builder()
                .id(leafId)
                .user(owner)
                .title("Leaf")
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(permissionService.requireTrashEditAccess(ownerId, leafId)).thenReturn(leaf);
        when(documentRepository.findIdsByParent_IdIn(List.of(leafId))).thenReturn(List.of());
        when(attachmentService.findStorageKeysForDocuments(List.of(leafId))).thenReturn(List.of("leaf/f"));
        doThrow(new RuntimeException("attachment delete failed"))
                .when(attachmentService)
                .deleteForDocuments(List.of(leafId));

        assertThrows(RuntimeException.class, () -> documentService.delete(ownerId, leafId, true));

        // Fail closed: document rows must survive so a retry still finds them, and the
        // collected file keys must not be scheduled for deletion either.
        verify(documentRepository, never()).deleteByIdIn(any());
        verify(attachmentService, never()).deleteStoredFilesAfterCommit(any());
    }

    @Test
    void purgeExpiredTrash_withNoExpiredRoots_doesNothing() {
        OffsetDateTime asOf = OffsetDateTime.of(2025, 6, 15, 12, 0, 0, 0, ZoneOffset.UTC);
        when(documentRepository.findExpiredTrashRoots(any(), any())).thenReturn(List.of());

        assertEquals(0, documentService.purgeExpiredTrash(asOf));

        verify(documentRepository).findExpiredTrashRoots(any(), any());
        verify(documentRepository, never()).deleteByIdIn(any());
        verify(attachmentService, never()).findStorageKeysForDocuments(any());
    }

    private static Document trashedDoc(User owner, UUID id, String title, Document parent) {
        return Document.builder()
                .id(id)
                .user(owner)
                .title(title)
                .parent(parent)
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();
    }

    @Test
    void create_persistsClientProvidedId() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        User user = User.builder()
                .id(userId)
                .email("alice@example.com")
                .displayName("Alice")
                .build();
        DocumentCreateRequest request =
                new DocumentCreateRequest(documentId, "My Doc", "AQID", "Alice", null, null, null);

        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(documentRepository.findById(documentId)).thenReturn(Optional.empty());
        when(userDocumentOrderRepository.findMinOrderKeyByUserId(userId, documentId))
                .thenReturn(Optional.empty());
        when(documentRepository.saveAndFlush(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));

        DocumentService.CreateDocumentResult result = documentService.create(userId, request);

        assertTrue(result.created());
        assertEquals(documentId, result.document().id());
        verify(documentRepository).findById(documentId);
        verify(documentRepository).saveAndFlush(any(Document.class));
        verify(userDocumentOrderRepository).saveAndFlush(any(UserDocumentOrder.class));
    }

    @Test
    void create_placesNewRootDocumentFirstInUserDocumentOrder() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        User user = User.builder()
                .id(userId)
                .email("alice@example.com")
                .displayName("Alice")
                .build();
        DocumentCreateRequest request =
                new DocumentCreateRequest(documentId, "My Doc", "AQID", "Alice", null, null, null);

        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(documentRepository.findById(documentId)).thenReturn(Optional.empty());
        when(userDocumentOrderRepository.findMinOrderKeyByUserId(userId, documentId))
                .thenReturn(Optional.of("a5"));
        when(documentRepository.saveAndFlush(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));

        documentService.create(userId, request);

        ArgumentCaptor<UserDocumentOrder> savedOrderCaptor = ArgumentCaptor.forClass(UserDocumentOrder.class);
        verify(userDocumentOrderRepository).saveAndFlush(savedOrderCaptor.capture());
        assertTrue(savedOrderCaptor.getValue().getOrderKey().compareTo("a5") < 0);
    }

    @Test
    void create_returnsExistingDocumentForMatchingClientProvidedId() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        User user = User.builder()
                .id(userId)
                .email("alice@example.com")
                .displayName("Alice")
                .build();
        Document existing = Document.builder()
                .id(documentId)
                .user(user)
                .title("Existing")
                .yjsState(new byte[] {1, 2, 3})
                .createdBy("Alice")
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .updatedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();
        DocumentCreateRequest request =
                new DocumentCreateRequest(documentId, "My Doc", "AQID", "Alice", null, null, null);

        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(documentRepository.findById(documentId)).thenReturn(Optional.of(existing));

        DocumentService.CreateDocumentResult result = documentService.create(userId, request);

        assertEquals(false, result.created());
        assertEquals(documentId, result.document().id());
        verify(documentRepository, never()).saveAndFlush(any(Document.class));
    }

    @Test
    void create_rejectsTrashedDocumentIdReuse() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        User user = User.builder()
                .id(userId)
                .email("alice@example.com")
                .displayName("Alice")
                .build();
        Document existing = Document.builder()
                .id(documentId)
                .user(user)
                .title("Existing")
                .yjsState(new byte[] {1, 2, 3})
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();
        DocumentCreateRequest request =
                new DocumentCreateRequest(documentId, "My Doc", "AQID", "Alice", null, null, null);

        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(documentRepository.findById(documentId)).thenReturn(Optional.of(existing));

        ApiException exception = assertThrows(ApiException.class, () -> documentService.create(userId, request));

        assertEquals(ErrorCode.CONFLICT, exception.getErrorCode());
        verify(documentRepository, never()).saveAndFlush(any(Document.class));
    }

    @Test
    void create_retriesOnOrderKeyCollision() {
        UUID userId = UUID.randomUUID();
        User user = User.builder()
                .id(userId)
                .email("alice@example.com")
                .displayName("Alice")
                .build();
        DocumentCreateRequest request = new DocumentCreateRequest(null, "My Doc", "AQID", "Alice", null, null, null);

        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(userDocumentOrderRepository.findMinOrderKeyByUserId(eq(userId), any()))
                .thenReturn(Optional.of("a5"), Optional.of("a4"));
        when(documentRepository.saveAndFlush(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(userDocumentOrderRepository.saveAndFlush(any(UserDocumentOrder.class)))
                .thenThrow(new DataIntegrityViolationException("order_key unique violation"))
                .thenAnswer(invocation -> invocation.getArgument(0));

        DocumentService.CreateDocumentResult result = documentService.create(userId, request);

        assertTrue(result.created());
        ArgumentCaptor<UserDocumentOrder> captor = ArgumentCaptor.forClass(UserDocumentOrder.class);
        verify(userDocumentOrderRepository, times(2)).saveAndFlush(captor.capture());
        List<UserDocumentOrder> saved = captor.getAllValues();
        assertEquals(2, saved.size());
        assertTrue(saved.get(1).getOrderKey().compareTo("a4") < 0);
    }

    @Test
    void restore_regeneratesInvalidUserDocumentOrder() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        User user = User.builder()
                .id(userId)
                .email("alice@example.com")
                .displayName("Alice")
                .build();
        Document trashed = Document.builder()
                .id(documentId)
                .user(user)
                .title("Trashed")
                .yjsState(new byte[] {1})
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(permissionService.requireTrashEditAccess(userId, documentId)).thenReturn(trashed);
        when(userDocumentOrderRepository.findMaxOrderKeyByUserId(userId, documentId))
                .thenReturn(Optional.of("a5"));
        when(userDocumentOrderRepository.findByUser_IdAndDocument_Id(userId, documentId))
                .thenReturn(Optional.empty());
        when(userDocumentOrderRepository.findOrderKeyByUserIdAndDocumentId(userId, documentId))
                .thenReturn(Optional.of("a6"));
        when(documentRepository.saveAndFlush(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));

        DocumentResponse response = documentService.restore(userId, documentId);

        assertEquals("a6", response.orderKey());
        assertNull(response.deletedAt());
        verify(documentRepository).saveAndFlush(any(Document.class));
        verify(userDocumentOrderRepository).saveAndFlush(any(UserDocumentOrder.class));
    }

    @Test
    void get_allowsGeneralAccessWhenActiveLinkExists() {
        UUID requesterId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = createSharedDocument(documentId, DocumentAccessLevel.VIEW);

        when(permissionService.requireReadAccess(requesterId, documentId)).thenReturn(document);

        var response = documentService.get(requesterId, documentId, false);

        assertEquals(documentId, response.id());
        assertEquals("Shared doc", response.title());
    }

    @Test
    void get_floatedSharedDocument_returnsUserDocumentOrderKey() {
        UUID requesterId = UUID.randomUUID();
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID privateParentId = UUID.randomUUID();
        User owner = User.builder().id(ownerId).build();
        Document privateParent =
                Document.builder().id(privateParentId).user(owner).build();
        Document document = Document.builder()
                .id(documentId)
                .user(owner)
                .title("Floated Doc")
                .parent(privateParent)
                .siblingOrderKey("owner-sibling-key")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        when(permissionService.requireReadAccess(requesterId, documentId)).thenReturn(document);
        // Parent is inaccessible to requester
        when(permissionService.resolveAccess(requesterId, privateParentId)).thenReturn(null);
        when(userDocumentOrderRepository.findOrderKeyByUserIdAndDocumentId(requesterId, documentId))
                .thenReturn(Optional.of("user-order-key-1"));

        var response = documentService.get(requesterId, documentId, false);

        assertEquals(documentId, response.id());
        assertEquals("user-order-key-1", response.orderKey());
    }

    @Test
    void get_floatedSharedDocument_withoutUserDocumentOrder_returnsNullOrderKey() {
        UUID requesterId = UUID.randomUUID();
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID privateParentId = UUID.randomUUID();
        User owner = User.builder().id(ownerId).build();
        Document privateParent =
                Document.builder().id(privateParentId).user(owner).build();
        Document document = Document.builder()
                .id(documentId)
                .user(owner)
                .title("Floated Doc")
                .parent(privateParent)
                .siblingOrderKey("owner-sibling-key")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        when(permissionService.requireReadAccess(requesterId, documentId)).thenReturn(document);
        // Parent is inaccessible to requester
        when(permissionService.resolveAccess(requesterId, privateParentId)).thenReturn(null);
        when(userDocumentOrderRepository.findOrderKeyByUserIdAndDocumentId(requesterId, documentId))
                .thenReturn(Optional.empty());

        var response = documentService.get(requesterId, documentId, false);

        assertEquals(documentId, response.id());
        assertNull(response.orderKey());
    }

    @Test
    void get_nestedSharedDocumentUnderAccessibleParent_returnsSiblingOrderKey() {
        UUID requesterId = UUID.randomUUID();
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID sharedParentId = UUID.randomUUID();
        User owner = User.builder().id(ownerId).build();
        Document sharedParent =
                Document.builder().id(sharedParentId).user(owner).build();
        Document document = Document.builder()
                .id(documentId)
                .user(owner)
                .title("Nested Doc")
                .parent(sharedParent)
                .siblingOrderKey("sibling-key-1")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        when(permissionService.requireReadAccess(requesterId, documentId)).thenReturn(document);
        // Parent IS accessible to requester
        when(permissionService.resolveAccess(requesterId, sharedParentId)).thenReturn(DocumentAccessLevel.VIEW);

        var response = documentService.get(requesterId, documentId, false);

        assertEquals(documentId, response.id());
        assertEquals("sibling-key-1", response.orderKey());
    }

    @Test
    void get_includeTrashed_childOfTrashedAccessibleParent_resolvesParentTrashAccessAndReturnsSiblingKey() {
        UUID requesterId = UUID.randomUUID();
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        UUID sharedParentId = UUID.randomUUID();
        OffsetDateTime deletedAt = OffsetDateTime.now(ZoneOffset.UTC);
        User owner = User.builder().id(ownerId).build();
        Document sharedParent = Document.builder()
                .id(sharedParentId)
                .user(owner)
                .deletedAt(deletedAt)
                .build();
        Document trashedChild = Document.builder()
                .id(documentId)
                .user(owner)
                .title("Trashed Child")
                .parent(sharedParent)
                .siblingOrderKey("sibling-key-2")
                .deletedAt(deletedAt)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .updatedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(documentRepository.findById(documentId)).thenReturn(Optional.of(trashedChild));
        when(permissionService.resolveTrashAccess(requesterId, documentId)).thenReturn(DocumentAccessLevel.VIEW);
        when(permissionService.resolveTrashAccess(requesterId, sharedParentId)).thenReturn(DocumentAccessLevel.VIEW);

        var response = documentService.get(requesterId, documentId, true);

        assertEquals(documentId, response.id());
        assertEquals("sibling-key-2", response.orderKey());
        assertEquals(DocumentAccessLevel.VIEW, response.accessLevel());
    }

    @Test
    void update_allowsEditWhenGeneralAccessIsEdit() {
        UUID requesterId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = createSharedDocument(documentId, DocumentAccessLevel.EDIT);

        when(documentRepository.findById(documentId)).thenReturn(Optional.of(document));
        when(permissionService.resolveAccess(requesterId, documentId)).thenReturn(DocumentAccessLevel.EDIT);
        when(documentRepository.save(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));

        var response =
                documentService.update(requesterId, documentId, new DocumentUpdateRequest("Updated title", null, null));

        assertEquals("Updated title", response.title());
        verify(permissionService, atLeastOnce()).resolveAccess(requesterId, documentId);
    }

    @Test
    void update_returnsForbiddenWhenGeneralAccessIsReadOnly() {
        UUID requesterId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = createSharedDocument(documentId, DocumentAccessLevel.VIEW);

        when(documentRepository.findById(documentId)).thenReturn(Optional.of(document));
        when(permissionService.resolveAccess(requesterId, documentId)).thenReturn(DocumentAccessLevel.VIEW);

        ApiException exception = assertThrows(
                ApiException.class,
                () -> documentService.update(
                        requesterId, documentId, new DocumentUpdateRequest("Updated title", null, null)));

        assertEquals(ErrorCode.FORBIDDEN, exception.getErrorCode());
        verify(documentRepository, never()).save(any(Document.class));
    }

    @Test
    void update_blankTitle_fallsBackToUntitled() {
        UUID requesterId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = createSharedDocument(documentId, DocumentAccessLevel.EDIT);

        when(documentRepository.findById(documentId)).thenReturn(Optional.of(document));
        when(permissionService.resolveAccess(requesterId, documentId)).thenReturn(DocumentAccessLevel.EDIT);
        when(documentRepository.save(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));

        var response = documentService.update(requesterId, documentId, new DocumentUpdateRequest("", null, null));

        assertEquals("Untitled", response.title());
    }

    @Test
    void update_whitespaceTitle_fallsBackToUntitled() {
        UUID requesterId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = createSharedDocument(documentId, DocumentAccessLevel.EDIT);

        when(documentRepository.findById(documentId)).thenReturn(Optional.of(document));
        when(permissionService.resolveAccess(requesterId, documentId)).thenReturn(DocumentAccessLevel.EDIT);
        when(documentRepository.save(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));

        var response = documentService.update(requesterId, documentId, new DocumentUpdateRequest("   ", null, null));

        assertEquals("Untitled", response.title());
    }

    @Test
    void list_usesBatchOrderKeyLookupForRootDocuments() {
        UUID userId = UUID.randomUUID();
        User user = User.builder()
                .id(userId)
                .email("alice@example.com")
                .displayName("Alice")
                .build();

        Document root1 = Document.builder()
                .id(UUID.randomUUID())
                .user(user)
                .title("Root 1")
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .updatedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();
        Document root2 = Document.builder()
                .id(UUID.randomUUID())
                .user(user)
                .title("Root 2")
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .updatedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();
        Document parent = Document.builder()
                .id(UUID.randomUUID())
                .user(user)
                .title("Parent")
                .build();
        Document child = Document.builder()
                .id(UUID.randomUUID())
                .user(user)
                .title("Child")
                .parent(parent)
                .siblingOrderKey("b5")
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .updatedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        Page<DocumentResponse> page = new PageImpl<>(List.of());
        when(queryHelper.list(eq(userId), eq(null), eq("all"), eq(false), any()))
                .thenReturn(page);

        Page<DocumentResponse> result = documentService.list(userId, null, "all", false, null);

        assertEquals(0, result.getContent().size());
        verify(queryHelper).list(eq(userId), eq(null), eq("all"), eq(false), any());
    }

    @Test
    void delete_softDelete_withEditAccess_setsDeletedAtAndSaves() {
        UUID requesterId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = Document.builder()
                .id(documentId)
                .title("Child doc")
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .updatedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(permissionService.requireEditAccess(requesterId, documentId)).thenReturn(document);
        when(documentRepository.save(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));

        documentService.delete(requesterId, documentId, false);

        verify(permissionService).requireEditAccess(requesterId, documentId);
        verify(userDocumentOrderRepository).deleteByDocument_Id(documentId);
        ArgumentCaptor<Document> captor = ArgumentCaptor.forClass(Document.class);
        verify(documentRepository).save(captor.capture());
        assertTrue(captor.getValue().getDeletedAt() != null);
    }

    @Test
    void delete_softDelete_withViewOnlyAccess_throwsForbidden() {
        UUID requesterId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        doThrow(new ApiException(ErrorCode.FORBIDDEN))
                .when(permissionService)
                .requireEditAccess(requesterId, documentId);

        ApiException exception =
                assertThrows(ApiException.class, () -> documentService.delete(requesterId, documentId, false));

        assertEquals(ErrorCode.FORBIDDEN, exception.getErrorCode());
        verify(documentRepository, never()).save(any());
    }

    @Test
    void delete_softDelete_withNoAccess_throwsNotFound() {
        UUID requesterId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        doThrow(new ApiException(ErrorCode.NOT_FOUND))
                .when(permissionService)
                .requireEditAccess(requesterId, documentId);

        ApiException exception =
                assertThrows(ApiException.class, () -> documentService.delete(requesterId, documentId, false));

        assertEquals(ErrorCode.NOT_FOUND, exception.getErrorCode());
        verify(documentRepository, never()).save(any());
    }

    @Test
    void delete_permanentDelete_inTrash_deletesDocument() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        User owner = User.builder().id(ownerId).build();
        Document trashedDoc = Document.builder()
                .id(documentId)
                .user(owner)
                .title("Trashed doc")
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(permissionService.requireTrashEditAccess(ownerId, documentId)).thenReturn(trashedDoc);

        documentService.delete(ownerId, documentId, true);

        verify(userDocumentOrderRepository).deleteByDocument_IdIn(List.of(documentId));
        verify(documentRepository).deleteByIdIn(List.of(documentId));
    }

    @Test
    void delete_permanentDelete_notInTrash_throwsValidationFailed() {
        UUID ownerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        User owner = User.builder().id(ownerId).build();
        Document activeDoc = Document.builder()
                .id(documentId)
                .user(owner)
                .title("Active doc")
                .deletedAt(null)
                .build();

        when(permissionService.requireTrashEditAccess(ownerId, documentId)).thenReturn(activeDoc);

        ApiException exception =
                assertThrows(ApiException.class, () -> documentService.delete(ownerId, documentId, true));

        assertEquals(ErrorCode.VALIDATION_FAILED, exception.getErrorCode());
        verify(documentRepository, never()).delete(any());
    }

    @Test
    void create_nestedDocUnderForeignParent_assignsParentOwner() {
        UUID creatorId = UUID.randomUUID();
        UUID hostOwnerId = UUID.randomUUID();
        UUID parentId = UUID.randomUUID();
        User host = User.builder().id(hostOwnerId).build();
        Document parent = Document.builder().id(parentId).user(host).build();
        DocumentCreateRequest request =
                new DocumentCreateRequest(null, "Nested", "AQID", "Jerry", parentId, null, null);

        when(userRepository.findById(creatorId))
                .thenReturn(Optional.of(User.builder().id(creatorId).build()));
        when(permissionService.requireEditAccess(creatorId, parentId)).thenReturn(parent);
        when(documentRepository.saveAndFlush(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));

        DocumentService.CreateDocumentResult result = documentService.create(creatorId, request);

        assertTrue(result.created());
        ArgumentCaptor<Document> captor = ArgumentCaptor.forClass(Document.class);
        verify(documentRepository).saveAndFlush(captor.capture());
        // Location authority: the nested doc belongs to the host tree's owner, not the creator.
        assertEquals(hostOwnerId, captor.getValue().getUser().getId());
        // Creator attribution is preserved separately.
        assertEquals("Jerry", captor.getValue().getCreatedBy());
        // Nested docs get no personal navigation row.
        verify(userDocumentOrderRepository, never()).saveAndFlush(any(UserDocumentOrder.class));
    }

    @Test
    void create_nestedUnderTooDeepParent_throwsValidationFailed() {
        UUID creatorId = UUID.randomUUID();
        UUID parentId = UUID.randomUUID();
        User creator = User.builder().id(creatorId).build();
        Document parent = Document.builder().id(parentId).user(creator).build();
        DocumentCreateRequest request =
                new DocumentCreateRequest(null, "Nested", "AQID", "Alice", parentId, null, null);

        when(userRepository.findById(creatorId)).thenReturn(Optional.of(creator));
        when(permissionService.requireEditAccess(creatorId, parentId)).thenReturn(parent);
        // A parent with 99 ancestors would put the new document on a 101-node chain,
        // past every reader's 100-node bound.
        when(documentRepository.findAncestorChainIds(parentId)).thenReturn(Collections.nCopies(99, UUID.randomUUID()));

        ApiException exception = assertThrows(ApiException.class, () -> documentService.create(creatorId, request));

        assertEquals(ErrorCode.VALIDATION_FAILED, exception.getErrorCode());
        assertTrue(exception.getMessage().contains("100 levels deep"));
        verify(documentRepository, never()).saveAndFlush(any(Document.class));
    }

    @Test
    void create_nestedAtDepthLimit_succeeds() {
        UUID creatorId = UUID.randomUUID();
        UUID parentId = UUID.randomUUID();
        User creator = User.builder().id(creatorId).build();
        Document parent = Document.builder().id(parentId).user(creator).build();
        DocumentCreateRequest request =
                new DocumentCreateRequest(null, "Nested", "AQID", "Alice", parentId, null, null);

        when(userRepository.findById(creatorId)).thenReturn(Optional.of(creator));
        when(permissionService.requireEditAccess(creatorId, parentId)).thenReturn(parent);
        // 98 ancestors put the new document on exactly a 100-node chain: allowed.
        when(documentRepository.findAncestorChainIds(parentId)).thenReturn(Collections.nCopies(98, UUID.randomUUID()));
        when(documentRepository.saveAndFlush(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));

        DocumentService.CreateDocumentResult result = documentService.create(creatorId, request);

        assertTrue(result.created());
    }

    @Test
    void create_clientIdBelongsToForeignDocWithAccess_returnsExisting() {
        UUID creatorId = UUID.randomUUID();
        UUID hostOwnerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document existing = Document.builder()
                .id(documentId)
                .user(User.builder().id(hostOwnerId).build())
                .title("Hosted")
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .updatedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();
        DocumentCreateRequest request =
                new DocumentCreateRequest(documentId, "Retry", "AQID", "Jerry", null, null, null);

        when(userRepository.findById(creatorId))
                .thenReturn(Optional.of(User.builder().id(creatorId).build()));
        when(documentRepository.findById(documentId)).thenReturn(Optional.of(existing));
        when(permissionService.resolveAccess(creatorId, documentId)).thenReturn(DocumentAccessLevel.EDIT);

        DocumentService.CreateDocumentResult result = documentService.create(creatorId, request);

        assertFalse(result.created());
        assertEquals(documentId, result.document().id());
        verify(documentRepository, never()).saveAndFlush(any(Document.class));
    }

    @Test
    void create_clientIdBelongsToInaccessibleDoc_throwsConflict() {
        UUID strangerId = UUID.randomUUID();
        UUID hostOwnerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document existing = Document.builder()
                .id(documentId)
                .user(User.builder().id(hostOwnerId).build())
                .title("Hosted")
                .build();
        DocumentCreateRequest request =
                new DocumentCreateRequest(documentId, "Squat", "AQID", "Stranger", null, null, null);

        when(userRepository.findById(strangerId))
                .thenReturn(Optional.of(User.builder().id(strangerId).build()));
        when(documentRepository.findById(documentId)).thenReturn(Optional.of(existing));
        when(permissionService.resolveAccess(strangerId, documentId)).thenReturn(null);

        ApiException exception = assertThrows(ApiException.class, () -> documentService.create(strangerId, request));

        assertEquals(ErrorCode.CONFLICT, exception.getErrorCode());
    }

    @Test
    void create_nestedDocWithIdenticalSiblingKeys_throwsConflict() {
        UUID userId = UUID.randomUUID();
        UUID parentId = UUID.randomUUID();
        UUID prevSiblingId = UUID.randomUUID();
        UUID nextSiblingId = UUID.randomUUID();
        User user = User.builder().id(userId).build();
        Document parent = Document.builder().id(parentId).user(user).build();
        Document prevSibling = Document.builder()
                .id(prevSiblingId)
                .parent(parent)
                .siblingOrderKey("a0")
                .build();
        Document nextSibling = Document.builder()
                .id(nextSiblingId)
                .parent(parent)
                .siblingOrderKey("a0")
                .build();
        DocumentCreateRequest request =
                new DocumentCreateRequest(null, "Child", "AQID", "Alice", parentId, prevSiblingId, nextSiblingId);

        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(permissionService.requireEditAccess(userId, parentId)).thenReturn(parent);
        when(documentRepository.findByIdAndDeletedAtIsNull(prevSiblingId)).thenReturn(Optional.of(prevSibling));
        when(documentRepository.findByIdAndDeletedAtIsNull(nextSiblingId)).thenReturn(Optional.of(nextSibling));

        ApiException ex = assertThrows(ApiException.class, () -> documentService.create(userId, request));
        assertEquals(ErrorCode.CONFLICT, ex.getErrorCode());
    }

    @Test
    void create_rootDocWithIdenticalSiblingKeys_throwsConflict() {
        UUID userId = UUID.randomUUID();
        UUID prevSiblingId = UUID.randomUUID();
        UUID nextSiblingId = UUID.randomUUID();
        User user = User.builder().id(userId).build();
        DocumentCreateRequest request =
                new DocumentCreateRequest(null, "Root Doc", "AQID", "Alice", null, prevSiblingId, nextSiblingId);

        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(documentRepository.findByIdAndDeletedAtIsNull(prevSiblingId))
                .thenReturn(Optional.of(Document.builder().id(prevSiblingId).build()));
        when(documentRepository.findByIdAndDeletedAtIsNull(nextSiblingId))
                .thenReturn(Optional.of(Document.builder().id(nextSiblingId).build()));
        when(userDocumentOrderRepository.findOrderKeyByUserIdAndDocumentId(userId, prevSiblingId))
                .thenReturn(Optional.of("a0"));
        when(userDocumentOrderRepository.findOrderKeyByUserIdAndDocumentId(userId, nextSiblingId))
                .thenReturn(Optional.of("a0"));
        when(documentRepository.saveAndFlush(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));

        ApiException ex = assertThrows(ApiException.class, () -> documentService.create(userId, request));
        assertEquals(ErrorCode.CONFLICT, ex.getErrorCode());
    }

    @Test
    void create_rootDocWithNestedPrevSibling_throwsValidationFailed() {
        UUID userId = UUID.randomUUID();
        UUID prevSiblingId = UUID.randomUUID();
        User user = User.builder().id(userId).build();
        DocumentCreateRequest request =
                new DocumentCreateRequest(null, "Root Doc", "AQID", "Alice", null, prevSiblingId, null);

        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(documentRepository.findByIdAndDeletedAtIsNull(prevSiblingId))
                .thenReturn(Optional.of(Document.builder().id(prevSiblingId).build()));
        when(userDocumentOrderRepository.findOrderKeyByUserIdAndDocumentId(userId, prevSiblingId))
                .thenReturn(Optional.empty());
        when(documentRepository.saveAndFlush(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));

        ApiException ex = assertThrows(ApiException.class, () -> documentService.create(userId, request));
        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
        assertEquals("sibling does not belong to root navigation", ex.getMessage());
    }

    @Test
    void create_rootDocWithNestedNextSibling_throwsValidationFailed() {
        UUID userId = UUID.randomUUID();
        UUID nextSiblingId = UUID.randomUUID();
        User user = User.builder().id(userId).build();
        DocumentCreateRequest request =
                new DocumentCreateRequest(null, "Root Doc", "AQID", "Alice", null, null, nextSiblingId);

        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(documentRepository.findByIdAndDeletedAtIsNull(nextSiblingId))
                .thenReturn(Optional.of(Document.builder().id(nextSiblingId).build()));
        when(userDocumentOrderRepository.findOrderKeyByUserIdAndDocumentId(userId, nextSiblingId))
                .thenReturn(Optional.empty());
        when(documentRepository.saveAndFlush(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));

        ApiException ex = assertThrows(ApiException.class, () -> documentService.create(userId, request));
        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
        assertEquals("sibling does not belong to root navigation", ex.getMessage());
    }

    @Test
    void delete_permanentDelete_inTrashRoot_permanentlyDeletesParentAndAllDescendants() {
        UUID ownerId = UUID.randomUUID();
        UUID parentDocId = UUID.randomUUID();
        UUID childDocId = UUID.randomUUID();
        User owner = User.builder().id(ownerId).build();
        Document parentDoc = Document.builder()
                .id(parentDocId)
                .user(owner)
                .title("Parent Doc")
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();
        Document childDoc = Document.builder()
                .id(childDocId)
                .user(owner)
                .parent(parentDoc)
                .siblingOrderKey("a5")
                .title("Child Doc")
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(permissionService.requireTrashEditAccess(ownerId, parentDocId)).thenReturn(parentDoc);
        when(documentRepository.findIdsByParent_IdIn(List.of(parentDocId))).thenReturn(List.of(childDocId));
        when(documentRepository.findIdsByParent_IdIn(List.of(childDocId))).thenReturn(List.of());

        documentService.delete(ownerId, parentDocId, true);

        verify(collaboratorRepository).deleteByDocument_IdIn(List.of(childDocId));
        verify(userDocumentOrderRepository).deleteByDocument_IdIn(List.of(childDocId));
        verify(documentRepository).deleteByIdIn(List.of(childDocId));

        verify(collaboratorRepository).deleteByDocument_IdIn(List.of(parentDocId));
        verify(userDocumentOrderRepository).deleteByDocument_IdIn(List.of(parentDocId));
        verify(documentRepository).deleteByIdIn(List.of(parentDocId));
    }

    @Test
    void delete_permanentDelete_childOfTrashedParent_throwsValidationFailed() {
        UUID ownerId = UUID.randomUUID();
        UUID parentDocId = UUID.randomUUID();
        UUID childDocId = UUID.randomUUID();
        User owner = User.builder().id(ownerId).build();
        Document parentDoc = Document.builder()
                .id(parentDocId)
                .user(owner)
                .title("Parent Doc")
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();
        Document childDoc = Document.builder()
                .id(childDocId)
                .user(owner)
                .parent(parentDoc)
                .title("Child Doc")
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(permissionService.requireTrashEditAccess(ownerId, childDocId)).thenReturn(childDoc);

        ApiException ex = assertThrows(ApiException.class, () -> documentService.delete(ownerId, childDocId, true));
        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
        assertEquals(
                "Cannot permanently delete a child of a trashed document directly. Delete the parent document instead.",
                ex.getMessage());
    }

    @Test
    void delete_softDelete_cascadesToAllDescendants() {
        UUID ownerId = UUID.randomUUID();
        UUID parentDocId = UUID.randomUUID();
        UUID childDocId = UUID.randomUUID();
        User owner = User.builder().id(ownerId).build();
        Document parentDoc = Document.builder()
                .id(parentDocId)
                .user(owner)
                .title("Parent Doc")
                .build();
        Document childDoc = Document.builder()
                .id(childDocId)
                .user(owner)
                .parent(parentDoc)
                .siblingOrderKey("a5")
                .title("Child Doc")
                .build();

        when(permissionService.requireEditAccess(ownerId, parentDocId)).thenReturn(parentDoc);
        when(documentRepository.findAllByParent_IdIn(List.of(parentDocId))).thenReturn(List.of(childDoc));
        when(documentRepository.findAllByParent_IdIn(List.of(childDocId))).thenReturn(List.of());

        documentService.delete(ownerId, parentDocId, false);

        assertNotNull(parentDoc.getDeletedAt());
        assertNotNull(childDoc.getDeletedAt());
        verify(userDocumentOrderRepository).deleteByDocument_Id(parentDocId);
        verify(userDocumentOrderRepository).deleteByDocument_Id(childDocId);
        verify(documentRepository).save(parentDoc);
        verify(documentRepository).save(childDoc);
    }

    @Test
    void delete_softDelete_preservesDeletedAtForAlreadyTrashedDescendants() {
        UUID ownerId = UUID.randomUUID();
        UUID parentDocId = UUID.randomUUID();
        UUID alreadyTrashedChildId = UUID.randomUUID();
        UUID activeChildId = UUID.randomUUID();
        User owner = User.builder().id(ownerId).build();
        OffsetDateTime originalDeletedAt = OffsetDateTime.of(2025, 1, 1, 10, 0, 0, 0, ZoneOffset.UTC);

        Document parentDoc = Document.builder()
                .id(parentDocId)
                .user(owner)
                .title("Parent Doc")
                .build();
        Document alreadyTrashedChild = Document.builder()
                .id(alreadyTrashedChildId)
                .user(owner)
                .parent(parentDoc)
                .title("Already Trashed Child")
                .deletedAt(originalDeletedAt)
                .build();
        Document activeChild = Document.builder()
                .id(activeChildId)
                .user(owner)
                .parent(parentDoc)
                .title("Active Child")
                .build();

        when(permissionService.requireEditAccess(ownerId, parentDocId)).thenReturn(parentDoc);
        when(documentRepository.findAllByParent_IdIn(List.of(parentDocId)))
                .thenReturn(List.of(alreadyTrashedChild, activeChild));
        when(documentRepository.findAllByParent_IdIn(List.of(alreadyTrashedChildId, activeChildId)))
                .thenReturn(List.of());

        documentService.delete(ownerId, parentDocId, false);

        assertNotNull(parentDoc.getDeletedAt());
        assertNotNull(activeChild.getDeletedAt());
        assertEquals(originalDeletedAt, alreadyTrashedChild.getDeletedAt());
        verify(userDocumentOrderRepository).deleteByDocument_Id(parentDocId);
        verify(userDocumentOrderRepository).deleteByDocument_Id(activeChildId);
        verify(userDocumentOrderRepository, never()).deleteByDocument_Id(alreadyTrashedChildId);
        verify(documentRepository).save(parentDoc);
        verify(documentRepository).save(activeChild);
        verify(documentRepository, never()).save(alreadyTrashedChild);
    }

    @Test
    void restore_childOfTrashedParent_throwsValidationFailed() {
        UUID ownerId = UUID.randomUUID();
        UUID parentDocId = UUID.randomUUID();
        UUID childDocId = UUID.randomUUID();
        User owner = User.builder().id(ownerId).build();
        Document parentDoc = Document.builder()
                .id(parentDocId)
                .user(owner)
                .title("Parent Doc")
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();
        Document childDoc = Document.builder()
                .id(childDocId)
                .user(owner)
                .parent(parentDoc)
                .title("Child Doc")
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(permissionService.requireTrashEditAccess(ownerId, childDocId)).thenReturn(childDoc);

        ApiException ex =
                assertThrows(ApiException.class, () -> documentService.restoreAndPersist(ownerId, childDocId, false));
        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
        assertEquals(
                "Cannot restore a child of a trashed document directly. Restore the parent document instead.",
                ex.getMessage());
    }

    @Test
    void restore_trashRoot_restoresParentAndAllDescendants() {
        UUID ownerId = UUID.randomUUID();
        UUID parentDocId = UUID.randomUUID();
        UUID childDocId = UUID.randomUUID();
        User owner = User.builder().id(ownerId).build();
        Document parentDoc = Document.builder()
                .id(parentDocId)
                .user(owner)
                .title("Parent Doc")
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();
        Document childDoc = Document.builder()
                .id(childDocId)
                .user(owner)
                .parent(parentDoc)
                .siblingOrderKey("a5")
                .title("Child Doc")
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(permissionService.requireTrashEditAccess(ownerId, parentDocId)).thenReturn(parentDoc);
        when(userDocumentOrderRepository.findByUser_IdAndDocument_Id(ownerId, parentDocId))
                .thenReturn(Optional.empty());
        when(userDocumentOrderRepository.findMaxOrderKeyByUserId(ownerId, parentDocId))
                .thenReturn(Optional.of("a0"));
        when(collaboratorRepository.findAllByDocument_Id(parentDocId)).thenReturn(List.of());
        when(documentRepository.saveAndFlush(parentDoc)).thenReturn(parentDoc);
        when(documentRepository.findAllByParent_IdIn(List.of(parentDocId))).thenReturn(List.of(childDoc));
        when(documentRepository.findAllByParent_IdIn(List.of(childDocId))).thenReturn(List.of());

        DocumentResponse response = documentService.restoreAndPersist(ownerId, parentDocId, false);

        assertNull(parentDoc.getDeletedAt());
        assertNull(childDoc.getDeletedAt());
        verify(userDocumentOrderRepository).saveAndFlush(any(UserDocumentOrder.class));
        verify(documentRepository).saveAndFlush(parentDoc);
        verify(documentRepository).saveAndFlush(childDoc);
        assertEquals(parentDocId, response.id());
    }

    @Test
    void create_orderKeyCollisionWithExplicitId_retriesAndSucceeds() {
        UUID userId = UUID.randomUUID();
        User user = User.builder().id(userId).build();
        UUID explicitId = UUID.randomUUID();
        DocumentCreateRequest request =
                new DocumentCreateRequest(explicitId, "Retried Title", "eWFz", "Anonymous", null, null, null);

        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(userDocumentOrderRepository.findMinOrderKeyByUserId(userId, explicitId))
                .thenReturn(Optional.of("a0"));
        when(documentRepository.saveAndFlush(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));

        // First attempt throws DataIntegrityViolationException on saveAndFlush
        when(userDocumentOrderRepository.saveAndFlush(any(UserDocumentOrder.class)))
                .thenThrow(new DataIntegrityViolationException("unique violation"))
                .thenAnswer(invocation -> invocation.getArgument(0));

        // Because transaction rolled back, findById returns empty, allowing retry
        when(documentRepository.findById(explicitId)).thenReturn(Optional.empty());

        DocumentService.CreateDocumentResult result = documentService.create(userId, request);

        assertTrue(result.created());
        assertEquals("Retried Title", result.document().title());
        assertEquals(explicitId, result.document().id());
        verify(userDocumentOrderRepository, times(2)).saveAndFlush(any(UserDocumentOrder.class));
    }

    @Test
    void restore_withEditAccess_restoresTrashedDocument() {
        UUID ownerId = UUID.randomUUID();
        UUID editorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document trashed = Document.builder()
                .id(documentId)
                .user(User.builder().id(ownerId).build())
                .title("Shared Trashed")
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(permissionService.requireTrashEditAccess(editorId, documentId)).thenReturn(trashed);
        when(userDocumentOrderRepository.findByUser_IdAndDocument_Id(ownerId, documentId))
                .thenReturn(Optional.empty());
        when(userDocumentOrderRepository.findMaxOrderKeyByUserId(ownerId, documentId))
                .thenReturn(Optional.empty());
        when(collaboratorRepository.findAllByDocument_Id(documentId)).thenReturn(List.of());
        when(documentRepository.saveAndFlush(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));

        DocumentResponse response = documentService.restoreAndPersist(editorId, documentId, false);

        assertNull(response.deletedAt());
        assertNull(trashed.getDeletedAt());
        ArgumentCaptor<UserDocumentOrder> udoCaptor = ArgumentCaptor.forClass(UserDocumentOrder.class);
        verify(userDocumentOrderRepository).saveAndFlush(udoCaptor.capture());
        assertEquals(ownerId, udoCaptor.getValue().getUser().getId());
    }

    @Test
    void restore_asCollaborator_restoresOwnerOrderRowInOwnerKeySpaceAndCollaboratorOrderRow() {
        UUID ownerId = UUID.randomUUID();
        UUID editorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        User owner = User.builder().id(ownerId).build();
        User editor = User.builder().id(editorId).build();
        Document trashed = Document.builder()
                .id(documentId)
                .user(owner)
                .title("Shared Trashed")
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();
        DocumentCollaborator collaborator = DocumentCollaborator.builder()
                .document(trashed)
                .user(editor)
                .accessLevel(DocumentAccessLevel.EDIT)
                .build();

        when(permissionService.requireTrashEditAccess(editorId, documentId)).thenReturn(trashed);
        when(userDocumentOrderRepository.findByUser_IdAndDocument_Id(ownerId, documentId))
                .thenReturn(Optional.empty());
        when(userDocumentOrderRepository.findMaxOrderKeyByUserId(ownerId, documentId))
                .thenReturn(Optional.of("a0"));
        when(collaboratorRepository.findAllByDocument_Id(documentId)).thenReturn(List.of(collaborator));
        when(userDocumentOrderRepository.existsByUser_IdAndDocument_Id(editorId, documentId))
                .thenReturn(false);
        when(userDocumentOrderRepository.findMinOrderKeyByUserId(editorId, documentId))
                .thenReturn(Optional.of("z9"));
        when(documentRepository.saveAndFlush(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));

        DocumentResponse response = documentService.restoreAndPersist(editorId, documentId, false);

        assertNull(response.deletedAt());
        ArgumentCaptor<UserDocumentOrder> udoCaptor = ArgumentCaptor.forClass(UserDocumentOrder.class);
        verify(userDocumentOrderRepository, times(2)).saveAndFlush(udoCaptor.capture());
        List<UserDocumentOrder> savedUdos = udoCaptor.getAllValues();
        assertEquals(ownerId, savedUdos.get(0).getUser().getId());
        assertTrue(savedUdos.get(0).getOrderKey().compareTo("a0") > 0);
        assertEquals(editorId, savedUdos.get(1).getUser().getId());
        assertTrue(savedUdos.get(1).getOrderKey().compareTo("z9") < 0);
    }

    @Test
    void restore_withViewOnlyAccess_throwsForbidden() {
        UUID viewerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        doThrow(new ApiException(ErrorCode.FORBIDDEN))
                .when(permissionService)
                .requireTrashEditAccess(viewerId, documentId);

        ApiException exception =
                assertThrows(ApiException.class, () -> documentService.restoreAndPersist(viewerId, documentId, false));

        assertEquals(ErrorCode.FORBIDDEN, exception.getErrorCode());
        verify(documentRepository, never()).saveAndFlush(any(Document.class));
    }

    @Test
    void restore_withNoAccess_throwsNotFound() {
        UUID strangerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        doThrow(new ApiException(ErrorCode.NOT_FOUND))
                .when(permissionService)
                .requireTrashEditAccess(strangerId, documentId);

        ApiException exception = assertThrows(
                ApiException.class, () -> documentService.restoreAndPersist(strangerId, documentId, false));

        assertEquals(ErrorCode.NOT_FOUND, exception.getErrorCode());
    }

    @Test
    void restore_activeDocument_throwsNotFound() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document active = Document.builder()
                .id(documentId)
                .user(User.builder().id(userId).build())
                .title("Active")
                .build();

        when(permissionService.requireTrashEditAccess(userId, documentId)).thenReturn(active);

        ApiException exception =
                assertThrows(ApiException.class, () -> documentService.restoreAndPersist(userId, documentId, false));

        assertEquals(ErrorCode.NOT_FOUND, exception.getErrorCode());
    }

    @Test
    void restore_recreatesCollaboratorOrderRowsForRestoredDescendant() {
        UUID ownerId = UUID.randomUUID();
        UUID collaboratorId = UUID.randomUUID();
        UUID parentDocId = UUID.randomUUID();
        UUID childDocId = UUID.randomUUID();
        User owner = User.builder().id(ownerId).build();
        Document parentDoc = Document.builder()
                .id(parentDocId)
                .user(owner)
                .title("Parent Doc")
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();
        Document childDoc = Document.builder()
                .id(childDocId)
                .user(owner)
                .parent(parentDoc)
                .siblingOrderKey("a5")
                .title("Child Doc")
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();
        DocumentCollaborator collaborator = DocumentCollaborator.builder()
                .document(childDoc)
                .user(User.builder().id(collaboratorId).build())
                .build();

        when(permissionService.requireTrashEditAccess(ownerId, parentDocId)).thenReturn(parentDoc);
        when(userDocumentOrderRepository.findByUser_IdAndDocument_Id(ownerId, parentDocId))
                .thenReturn(Optional.empty());
        when(userDocumentOrderRepository.findMaxOrderKeyByUserId(ownerId, parentDocId))
                .thenReturn(Optional.of("a0"));
        when(collaboratorRepository.findAllByDocument_Id(parentDocId)).thenReturn(List.of());
        when(documentRepository.saveAndFlush(parentDoc)).thenReturn(parentDoc);
        when(documentRepository.findAllByParent_IdIn(List.of(parentDocId))).thenReturn(List.of(childDoc));
        when(documentRepository.findAllByParent_IdIn(List.of(childDocId))).thenReturn(List.of());
        when(collaboratorRepository.findAllByDocument_Id(childDocId)).thenReturn(List.of(collaborator));
        when(userDocumentOrderRepository.existsByUser_IdAndDocument_Id(collaboratorId, childDocId))
                .thenReturn(false);
        when(userDocumentOrderRepository.findMinOrderKeyByUserId(collaboratorId, childDocId))
                .thenReturn(Optional.empty());

        documentService.restoreAndPersist(ownerId, parentDocId, false);

        assertNull(childDoc.getDeletedAt());
        ArgumentCaptor<UserDocumentOrder> captor = ArgumentCaptor.forClass(UserDocumentOrder.class);
        verify(userDocumentOrderRepository, times(2)).saveAndFlush(captor.capture());
        List<UserDocumentOrder> saved = captor.getAllValues();
        assertEquals(ownerId, saved.get(0).getUser().getId());
        assertEquals(parentDocId, saved.get(0).getDocument().getId());
        assertEquals(collaboratorId, saved.get(1).getUser().getId());
        assertEquals(childDocId, saved.get(1).getDocument().getId());
    }

    @Test
    void delete_permanentDelete_withEditAccess_deletesTrashedDocument() {
        UUID ownerId = UUID.randomUUID();
        UUID editorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document trashedDoc = Document.builder()
                .id(documentId)
                .user(User.builder().id(ownerId).build())
                .title("Trashed doc")
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(permissionService.requireTrashEditAccess(editorId, documentId)).thenReturn(trashedDoc);

        documentService.delete(editorId, documentId, true);

        verify(userDocumentOrderRepository).deleteByDocument_IdIn(List.of(documentId));
        verify(documentRepository).deleteByIdIn(List.of(documentId));
    }

    @Test
    void delete_permanentDelete_noAccess_throwsNotFound() {
        UUID strangerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();

        doThrow(new ApiException(ErrorCode.NOT_FOUND))
                .when(permissionService)
                .requireTrashEditAccess(strangerId, documentId);

        ApiException exception =
                assertThrows(ApiException.class, () -> documentService.delete(strangerId, documentId, true));

        assertEquals(ErrorCode.NOT_FOUND, exception.getErrorCode());
        verify(documentRepository, never()).deleteByIdIn(any());
    }

    @Test
    void get_includeTrashed_allowsEditorOfTrashedDocument() {
        UUID ownerId = UUID.randomUUID();
        UUID editorId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document trashed = Document.builder()
                .id(documentId)
                .user(User.builder().id(ownerId).build())
                .title("Shared Trashed")
                .yjsState(new byte[] {1})
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .updatedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(documentRepository.findById(documentId)).thenReturn(Optional.of(trashed));
        when(permissionService.resolveTrashAccess(editorId, documentId)).thenReturn(DocumentAccessLevel.EDIT);

        var response = documentService.get(editorId, documentId, true);

        assertEquals(documentId, response.id());
        assertNotNull(response.deletedAt());
    }

    @Test
    void get_includeTrashed_allowsViewOnlyCollaboratorReadOnly() {
        UUID ownerId = UUID.randomUUID();
        UUID viewerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        OffsetDateTime deletedAt = OffsetDateTime.now(ZoneOffset.UTC);
        Document trashed = Document.builder()
                .id(documentId)
                .user(User.builder().id(ownerId).build())
                .title("Shared Trashed")
                .deletedAt(deletedAt)
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .updatedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(documentRepository.findById(documentId)).thenReturn(Optional.of(trashed));
        when(permissionService.resolveTrashAccess(viewerId, documentId)).thenReturn(DocumentAccessLevel.VIEW);

        var response = documentService.get(viewerId, documentId, true);

        assertEquals(documentId, response.id());
        assertNotNull(response.deletedAt());
    }

    @Test
    void get_includeTrashed_strangerGetsNotFound() {
        UUID ownerId = UUID.randomUUID();
        UUID strangerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document trashed = Document.builder()
                .id(documentId)
                .user(User.builder().id(ownerId).build())
                .title("Shared Trashed")
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .updatedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(documentRepository.findById(documentId)).thenReturn(Optional.of(trashed));
        when(permissionService.resolveTrashAccess(strangerId, documentId)).thenReturn(null);

        ApiException exception =
                assertThrows(ApiException.class, () -> documentService.get(strangerId, documentId, true));

        assertEquals(ErrorCode.NOT_FOUND, exception.getErrorCode());
    }

    @Test
    void update_trashedDocumentWithAnyTrashAccess_throwsConflict() {
        UUID ownerId = UUID.randomUUID();
        UUID viewerId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document trashed = Document.builder()
                .id(documentId)
                .user(User.builder().id(ownerId).build())
                .title("Trashed")
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(documentRepository.findById(documentId)).thenReturn(Optional.of(trashed));
        when(permissionService.resolveTrashAccess(viewerId, documentId)).thenReturn(DocumentAccessLevel.COMMENT);

        ApiException exception = assertThrows(
                ApiException.class,
                () -> documentService.update(viewerId, documentId, new DocumentUpdateRequest("New title", null, null)));

        assertEquals(ErrorCode.CONFLICT, exception.getErrorCode());
    }

    @Test
    void delete_softDelete_cycleGuard_throwsValidationFailed() {
        UUID ownerId = UUID.randomUUID();
        UUID rootId = UUID.randomUUID();
        Document root = Document.builder()
                .id(rootId)
                .user(User.builder().id(ownerId).build())
                .title("Root")
                .build();

        when(permissionService.requireEditAccess(ownerId, rootId)).thenReturn(root);
        when(documentRepository.save(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(documentRepository.findAllByParent_IdIn(any())).thenAnswer(invocation -> {
            java.util.Collection<UUID> parentIds = (java.util.Collection<UUID>) invocation.getArgument(0);
            UUID parentId = parentIds.iterator().next();
            return List.of(Document.builder()
                    .id(UUID.randomUUID())
                    .user(root.getUser())
                    .parent(Document.builder().id(parentId).build())
                    .title("Child")
                    .build());
        });

        ApiException exception = assertThrows(ApiException.class, () -> documentService.delete(ownerId, rootId, false));

        assertEquals(ErrorCode.VALIDATION_FAILED, exception.getErrorCode());
    }

    @Test
    void list_trashedOnly_returnsAccessibleTrashedDocuments() {
        UUID userId = UUID.randomUUID();
        User user = User.builder()
                .id(userId)
                .email("t@example.com")
                .displayName("T")
                .build();
        Document trashed = Document.builder()
                .id(UUID.randomUUID())
                .user(user)
                .title("Trashed")
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .updatedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        DocumentResponse trashedResponse = new DocumentResponse(
                trashed.getId(),
                "Trashed",
                null,
                null,
                null,
                false,
                false,
                DocumentAccessLevel.OWNER,
                "T",
                trashed.getCreatedAt(),
                trashed.getUpdatedAt(),
                trashed.getDeletedAt(),
                null);
        when(queryHelper.list(eq(userId), eq(null), eq("all"), eq(true), any()))
                .thenReturn(new PageImpl<>(List.of(trashedResponse)));

        Page<DocumentResponse> result = documentService.list(userId, null, "all", true, null);

        assertEquals(1, result.getContent().size());
        assertNotNull(result.getContent().get(0).deletedAt());
        assertNull(result.getContent().get(0).orderKey());
    }

    @Test
    void getBreadcrumbs_owner_returnsFullHierarchy() {
        UUID ownerId = UUID.randomUUID();
        User owner = User.builder().id(ownerId).email("alice@example.com").build();

        Document root = Document.builder()
                .id(UUID.randomUUID())
                .user(owner)
                .title("Root")
                .parent(null)
                .build();

        Document child = Document.builder()
                .id(UUID.randomUUID())
                .user(owner)
                .title("Child")
                .parent(root)
                .build();

        Document subChild = Document.builder()
                .id(UUID.randomUUID())
                .user(owner)
                .title("SubChild")
                .parent(child)
                .build();

        when(documentRepository.findById(subChild.getId())).thenReturn(Optional.of(subChild));
        when(permissionService.resolveAccess(ownerId, subChild.getId())).thenReturn(DocumentAccessLevel.OWNER);
        when(documentRepository.findAncestorChainIds(subChild.getId()))
                .thenReturn(List.of(child.getId(), root.getId()));
        when(documentRepository.findAllById(List.of(subChild.getId(), child.getId(), root.getId())))
                .thenReturn(List.of(subChild, child, root));
        when(permissionService.resolveAccessBatch(ownerId, List.of(subChild.getId(), child.getId(), root.getId())))
                .thenReturn(Map.of(
                        subChild.getId(), DocumentAccessLevel.OWNER,
                        child.getId(), DocumentAccessLevel.OWNER,
                        root.getId(), DocumentAccessLevel.OWNER));
        when(permissionService.resolveTrashAccessBatch(ownerId, List.of(subChild.getId(), child.getId(), root.getId())))
                .thenReturn(Map.of());

        List<DocumentBreadcrumbResponse> crumbs = documentService.getBreadcrumbs(ownerId, subChild.getId());

        assertEquals(3, crumbs.size());
        assertEquals("Root", crumbs.get(0).title());
        assertNull(crumbs.get(0).parentId());
        assertEquals("Child", crumbs.get(1).title());
        assertEquals(root.getId(), crumbs.get(1).parentId());
        assertEquals("SubChild", crumbs.get(2).title());
        assertEquals(child.getId(), crumbs.get(2).parentId());
    }

    @Test
    void getBreadcrumbs_trashedDocument_returnsBreadcrumbsForUserWithTrashAccess() {
        UUID ownerId = UUID.randomUUID();
        User owner = User.builder().id(ownerId).email("alice@example.com").build();

        Document root = Document.builder()
                .id(UUID.randomUUID())
                .user(owner)
                .title("Project Alpha")
                .parent(null)
                .build();

        Document trashedChild = Document.builder()
                .id(UUID.randomUUID())
                .user(owner)
                .title("Deleted Spec")
                .parent(root)
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();

        when(documentRepository.findById(trashedChild.getId())).thenReturn(Optional.of(trashedChild));
        when(permissionService.resolveTrashAccess(ownerId, trashedChild.getId()))
                .thenReturn(DocumentAccessLevel.OWNER);
        when(documentRepository.findAncestorChainIds(trashedChild.getId())).thenReturn(List.of(root.getId()));
        when(documentRepository.findAllById(List.of(trashedChild.getId(), root.getId())))
                .thenReturn(List.of(trashedChild, root));
        when(permissionService.resolveAccessBatch(ownerId, List.of(trashedChild.getId(), root.getId())))
                .thenReturn(Map.of(root.getId(), DocumentAccessLevel.OWNER));
        when(permissionService.resolveTrashAccessBatch(ownerId, List.of(trashedChild.getId(), root.getId())))
                .thenReturn(Map.of(trashedChild.getId(), DocumentAccessLevel.OWNER));

        List<DocumentBreadcrumbResponse> crumbs = documentService.getBreadcrumbs(ownerId, trashedChild.getId());

        assertEquals(2, crumbs.size());
        assertEquals("Project Alpha", crumbs.get(0).title());
        assertNull(crumbs.get(0).parentId());
        assertEquals("Deleted Spec", crumbs.get(1).title());
        assertEquals(root.getId(), crumbs.get(1).parentId());
    }

    @Test
    void getBreadcrumbs_collaboratorOnlyOnChild_stopsAtChildAndDoesNotExposePrivateParents() {
        UUID collaboratorId = UUID.randomUUID();
        User owner =
                User.builder().id(UUID.randomUUID()).email("owner@example.com").build();

        Document root = Document.builder()
                .id(UUID.randomUUID())
                .user(owner)
                .title("Secret Root")
                .parent(null)
                .build();

        Document child = Document.builder()
                .id(UUID.randomUUID())
                .user(owner)
                .title("Secret Parent")
                .parent(root)
                .build();

        Document subChild = Document.builder()
                .id(UUID.randomUUID())
                .user(owner)
                .title("Shared SubChild")
                .parent(child)
                .build();

        when(documentRepository.findById(subChild.getId())).thenReturn(Optional.of(subChild));
        when(permissionService.resolveAccess(collaboratorId, subChild.getId())).thenReturn(DocumentAccessLevel.VIEW);
        when(documentRepository.findAncestorChainIds(subChild.getId()))
                .thenReturn(List.of(child.getId(), root.getId()));
        when(documentRepository.findAllById(List.of(subChild.getId(), child.getId(), root.getId())))
                .thenReturn(List.of(subChild, child, root));
        when(permissionService.resolveAccessBatch(
                        collaboratorId, List.of(subChild.getId(), child.getId(), root.getId())))
                .thenReturn(Map.of(subChild.getId(), DocumentAccessLevel.VIEW));
        when(permissionService.resolveTrashAccessBatch(
                        collaboratorId, List.of(subChild.getId(), child.getId(), root.getId())))
                .thenReturn(Map.of());

        List<DocumentBreadcrumbResponse> crumbs = documentService.getBreadcrumbs(collaboratorId, subChild.getId());

        assertEquals(1, crumbs.size());
        assertEquals("Shared SubChild", crumbs.get(0).title());
        assertEquals(subChild.getId(), crumbs.get(0).id());
        assertNull(crumbs.get(0).parentId());
    }

    @Test
    void getBreadcrumbs_collaboratorOnParent_stopsAtParent() {
        UUID collaboratorId = UUID.randomUUID();
        User owner =
                User.builder().id(UUID.randomUUID()).email("owner@example.com").build();

        Document root = Document.builder()
                .id(UUID.randomUUID())
                .user(owner)
                .title("Secret Company Root")
                .parent(null)
                .build();

        Document child = Document.builder()
                .id(UUID.randomUUID())
                .user(owner)
                .title("Shared Project")
                .parent(root)
                .build();

        Document subChild = Document.builder()
                .id(UUID.randomUUID())
                .user(owner)
                .title("Tasks")
                .parent(child)
                .build();

        when(documentRepository.findById(subChild.getId())).thenReturn(Optional.of(subChild));
        when(permissionService.resolveAccess(collaboratorId, subChild.getId())).thenReturn(DocumentAccessLevel.EDIT);
        when(documentRepository.findAncestorChainIds(subChild.getId()))
                .thenReturn(List.of(child.getId(), root.getId()));
        when(documentRepository.findAllById(List.of(subChild.getId(), child.getId(), root.getId())))
                .thenReturn(List.of(subChild, child, root));
        when(permissionService.resolveAccessBatch(
                        collaboratorId, List.of(subChild.getId(), child.getId(), root.getId())))
                .thenReturn(
                        Map.of(subChild.getId(), DocumentAccessLevel.EDIT, child.getId(), DocumentAccessLevel.EDIT));
        when(permissionService.resolveTrashAccessBatch(
                        collaboratorId, List.of(subChild.getId(), child.getId(), root.getId())))
                .thenReturn(Map.of());

        List<DocumentBreadcrumbResponse> crumbs = documentService.getBreadcrumbs(collaboratorId, subChild.getId());

        assertEquals(2, crumbs.size());
        assertEquals("Shared Project", crumbs.get(0).title());
        assertNull(crumbs.get(0).parentId());
        assertEquals("Tasks", crumbs.get(1).title());
        assertEquals(child.getId(), crumbs.get(1).parentId());
    }

    @Test
    void getPublicBreadcrumbs_publicDocWithPrivateParent_stopsAtPublicDoc() {
        Document privateRoot = Document.builder()
                .id(UUID.randomUUID())
                .title("Private Org")
                .generalAccessMode(DocumentGeneralAccessMode.RESTRICTED)
                .parent(null)
                .build();

        Document publicDoc = Document.builder()
                .id(UUID.randomUUID())
                .title("Public Spec")
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .parent(privateRoot)
                .build();

        when(documentRepository.findByIdAndDeletedAtIsNull(publicDoc.getId())).thenReturn(Optional.of(publicDoc));
        when(permissionService.resolvePublicAccess(publicDoc.getId())).thenReturn(DocumentAccessLevel.VIEW);
        when(documentRepository.findAncestorChainIds(publicDoc.getId())).thenReturn(List.of(privateRoot.getId()));
        when(documentRepository.findAllById(List.of(publicDoc.getId(), privateRoot.getId())))
                .thenReturn(List.of(publicDoc, privateRoot));
        when(permissionService.resolvePublicAccessBatch(List.of(publicDoc.getId(), privateRoot.getId())))
                .thenReturn(Map.of(publicDoc.getId(), DocumentAccessLevel.VIEW));

        List<DocumentBreadcrumbResponse> crumbs = documentService.getPublicBreadcrumbs(publicDoc.getId());

        assertEquals(1, crumbs.size());
        assertEquals("Public Spec", crumbs.get(0).title());
        assertNull(crumbs.get(0).parentId());
    }

    @Test
    void getPublicBreadcrumbs_restrictedChildWithPublicParent_returnsInheritedHierarchy() {
        Document publicParent = Document.builder()
                .id(UUID.randomUUID())
                .title("Public Project")
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .parent(null)
                .build();

        Document restrictedChild = Document.builder()
                .id(UUID.randomUUID())
                .title("Inherited Task")
                .generalAccessMode(DocumentGeneralAccessMode.RESTRICTED)
                .parent(publicParent)
                .build();

        when(documentRepository.findByIdAndDeletedAtIsNull(restrictedChild.getId()))
                .thenReturn(Optional.of(restrictedChild));
        when(permissionService.resolvePublicAccess(restrictedChild.getId())).thenReturn(DocumentAccessLevel.VIEW);
        when(documentRepository.findAncestorChainIds(restrictedChild.getId()))
                .thenReturn(List.of(publicParent.getId()));
        when(documentRepository.findAllById(List.of(restrictedChild.getId(), publicParent.getId())))
                .thenReturn(List.of(restrictedChild, publicParent));
        when(permissionService.resolvePublicAccessBatch(List.of(restrictedChild.getId(), publicParent.getId())))
                .thenReturn(Map.of(
                        restrictedChild.getId(), DocumentAccessLevel.VIEW,
                        publicParent.getId(), DocumentAccessLevel.VIEW));

        List<DocumentBreadcrumbResponse> crumbs = documentService.getPublicBreadcrumbs(restrictedChild.getId());

        assertEquals(2, crumbs.size());
        assertEquals("Public Project", crumbs.get(0).title());
        assertNull(crumbs.get(0).parentId());
        assertEquals("Inherited Task", crumbs.get(1).title());
        assertEquals(publicParent.getId(), crumbs.get(1).parentId());
    }

    @Test
    void getPublicBreadcrumbs_privateDoc_throwsNotFound() {
        Document privateDoc = Document.builder()
                .id(UUID.randomUUID())
                .title("Private")
                .generalAccessMode(DocumentGeneralAccessMode.RESTRICTED)
                .parent(null)
                .build();

        when(documentRepository.findByIdAndDeletedAtIsNull(privateDoc.getId())).thenReturn(Optional.of(privateDoc));
        when(permissionService.resolvePublicAccess(privateDoc.getId())).thenReturn(null);

        ApiException ex =
                assertThrows(ApiException.class, () -> documentService.getPublicBreadcrumbs(privateDoc.getId()));
        assertEquals(ErrorCode.NOT_FOUND, ex.getErrorCode());
    }

    @Test
    void getPublicBreadcrumbs_publicDocWithPublicParent_returnsPublicHierarchy() {
        Document publicParent = Document.builder()
                .id(UUID.randomUUID())
                .title("Public Project")
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .parent(null)
                .build();

        Document publicChild = Document.builder()
                .id(UUID.randomUUID())
                .title("Public Task")
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .parent(publicParent)
                .build();

        when(documentRepository.findByIdAndDeletedAtIsNull(publicChild.getId())).thenReturn(Optional.of(publicChild));
        when(permissionService.resolvePublicAccess(publicChild.getId())).thenReturn(DocumentAccessLevel.VIEW);
        when(documentRepository.findAncestorChainIds(publicChild.getId())).thenReturn(List.of(publicParent.getId()));
        when(documentRepository.findAllById(List.of(publicChild.getId(), publicParent.getId())))
                .thenReturn(List.of(publicChild, publicParent));
        when(permissionService.resolvePublicAccessBatch(List.of(publicChild.getId(), publicParent.getId())))
                .thenReturn(Map.of(
                        publicChild.getId(), DocumentAccessLevel.VIEW,
                        publicParent.getId(), DocumentAccessLevel.VIEW));

        List<DocumentBreadcrumbResponse> crumbs = documentService.getPublicBreadcrumbs(publicChild.getId());

        assertEquals(2, crumbs.size());
        assertEquals("Public Project", crumbs.get(0).title());
        assertNull(crumbs.get(0).parentId());
        assertEquals("Public Task", crumbs.get(1).title());
        assertEquals(publicParent.getId(), crumbs.get(1).parentId());
    }

    @Test
    void getPublicBreadcrumbs_trashedPublicDoc_throwsNotFound() {
        UUID docId = UUID.randomUUID();
        when(documentRepository.findByIdAndDeletedAtIsNull(docId)).thenReturn(Optional.empty());

        ApiException ex = assertThrows(ApiException.class, () -> documentService.getPublicBreadcrumbs(docId));
        assertEquals(ErrorCode.NOT_FOUND, ex.getErrorCode());
    }

    @Test
    void getPublicBreadcrumbs_trashedParent_stopsAtPublicChild() {
        Document trashedPublicParent = Document.builder()
                .id(UUID.randomUUID())
                .title("Trashed Public Parent")
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .parent(null)
                .build();

        Document publicChild = Document.builder()
                .id(UUID.randomUUID())
                .title("Public Child")
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .parent(trashedPublicParent)
                .build();

        when(documentRepository.findByIdAndDeletedAtIsNull(publicChild.getId())).thenReturn(Optional.of(publicChild));
        when(permissionService.resolvePublicAccess(publicChild.getId())).thenReturn(DocumentAccessLevel.VIEW);
        when(documentRepository.findAncestorChainIds(publicChild.getId()))
                .thenReturn(List.of(trashedPublicParent.getId()));
        when(documentRepository.findAllById(List.of(publicChild.getId(), trashedPublicParent.getId())))
                .thenReturn(List.of(publicChild));
        when(permissionService.resolvePublicAccessBatch(List.of(publicChild.getId(), trashedPublicParent.getId())))
                .thenReturn(Map.of(publicChild.getId(), DocumentAccessLevel.VIEW));

        List<DocumentBreadcrumbResponse> crumbs = documentService.getPublicBreadcrumbs(publicChild.getId());

        assertEquals(1, crumbs.size());
        assertEquals("Public Child", crumbs.get(0).title());
        assertNull(crumbs.get(0).parentId());
    }

    @Test
    void getBreadcrumbs_blankOrNullTitle_fallsBackToUntitled() {
        UUID ownerId = UUID.randomUUID();
        User owner = User.builder().id(ownerId).email("alice@example.com").build();

        Document root = Document.builder()
                .id(UUID.randomUUID())
                .user(owner)
                .title("   ")
                .parent(null)
                .build();

        Document child = Document.builder()
                .id(UUID.randomUUID())
                .user(owner)
                .title(null)
                .parent(root)
                .build();

        when(documentRepository.findById(child.getId())).thenReturn(Optional.of(child));
        when(permissionService.resolveAccess(ownerId, child.getId())).thenReturn(DocumentAccessLevel.OWNER);
        when(documentRepository.findAncestorChainIds(child.getId())).thenReturn(List.of(root.getId()));
        when(documentRepository.findAllById(List.of(child.getId(), root.getId())))
                .thenReturn(List.of(child, root));
        when(permissionService.resolveAccessBatch(ownerId, List.of(child.getId(), root.getId())))
                .thenReturn(Map.of(child.getId(), DocumentAccessLevel.OWNER, root.getId(), DocumentAccessLevel.OWNER));
        when(permissionService.resolveTrashAccessBatch(ownerId, List.of(child.getId(), root.getId())))
                .thenReturn(Map.of());

        List<DocumentBreadcrumbResponse> crumbs = documentService.getBreadcrumbs(ownerId, child.getId());

        assertEquals(2, crumbs.size());
        assertEquals("Untitled", crumbs.get(0).title());
        assertEquals("Untitled", crumbs.get(1).title());
    }

    @Test
    void getPublicBreadcrumbs_blankOrNullTitle_fallsBackToUntitled() {
        Document publicDoc = Document.builder()
                .id(UUID.randomUUID())
                .title("   ")
                .generalAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK)
                .parent(null)
                .build();

        when(documentRepository.findByIdAndDeletedAtIsNull(publicDoc.getId())).thenReturn(Optional.of(publicDoc));
        when(permissionService.resolvePublicAccess(publicDoc.getId())).thenReturn(DocumentAccessLevel.VIEW);
        when(documentRepository.findAncestorChainIds(publicDoc.getId())).thenReturn(List.of());
        when(documentRepository.findAllById(List.of(publicDoc.getId()))).thenReturn(List.of(publicDoc));
        when(permissionService.resolvePublicAccessBatch(List.of(publicDoc.getId())))
                .thenReturn(Map.of(publicDoc.getId(), DocumentAccessLevel.VIEW));

        List<DocumentBreadcrumbResponse> crumbs = documentService.getPublicBreadcrumbs(publicDoc.getId());

        assertEquals(1, crumbs.size());
        assertEquals("Untitled", crumbs.get(0).title());
    }

    @Test
    void getPublic_restrictedChildOfPublicParent_returnsDocWithInheritedLevel() {
        UUID docId = UUID.randomUUID();
        Document child = createSharedDocument(docId, DocumentAccessLevel.VIEW);
        child.setGeneralAccessMode(DocumentGeneralAccessMode.RESTRICTED);

        when(documentRepository.findByIdAndDeletedAtIsNull(docId)).thenReturn(Optional.of(child));
        when(permissionService.resolvePublicAccess(docId)).thenReturn(DocumentAccessLevel.VIEW);
        when(documentRepository.countPublicChildrenByParentIds(any())).thenReturn(List.of());

        DocumentResponse response = documentService.getPublic(docId);

        assertEquals(docId, response.id());
        assertEquals(DocumentAccessLevel.VIEW, response.accessLevel());
        assertFalse(response.hasCollaborators());
    }

    @Test
    void getPublic_privateDoc_throwsNotFound() {
        UUID docId = UUID.randomUUID();
        Document privateDoc = createSharedDocument(docId, DocumentAccessLevel.VIEW);
        privateDoc.setGeneralAccessMode(DocumentGeneralAccessMode.RESTRICTED);

        when(documentRepository.findByIdAndDeletedAtIsNull(docId)).thenReturn(Optional.of(privateDoc));
        when(permissionService.resolvePublicAccess(docId)).thenReturn(null);

        ApiException ex = assertThrows(ApiException.class, () -> documentService.getPublic(docId));
        assertEquals(ErrorCode.NOT_FOUND, ex.getErrorCode());
    }

    @Test
    void getPublic_neverAsksForCollaboratorsOnBehalfOfAnAnonymousCaller() {
        UUID docId = UUID.randomUUID();
        Document doc = createSharedDocument(docId, DocumentAccessLevel.VIEW);
        doc.setGeneralAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK);

        when(documentRepository.findByIdAndDeletedAtIsNull(docId)).thenReturn(Optional.of(doc));
        when(permissionService.resolvePublicAccess(docId)).thenReturn(DocumentAccessLevel.VIEW);
        when(documentRepository.countPublicChildrenByParentIds(any())).thenReturn(List.of());

        DocumentResponse response = documentService.getPublic(docId);

        // A share-link reader holds no roster: reporting that the document has named
        // collaborators would leak the sharing state listPublicChildren keeps at false.
        assertFalse(response.hasCollaborators());
        verify(collaboratorRepository, never()).existsByDocument_Id(docId);
    }

    @Test
    void getPublic_hidesNonPublicChildrenFromAnonymousCaller() {
        UUID docId = UUID.randomUUID();
        Document doc = createSharedDocument(docId, DocumentAccessLevel.VIEW);
        doc.setGeneralAccessMode(DocumentGeneralAccessMode.ANYONE_WITH_LINK);

        when(documentRepository.findByIdAndDeletedAtIsNull(docId)).thenReturn(Optional.of(doc));
        when(permissionService.resolvePublicAccess(docId)).thenReturn(DocumentAccessLevel.VIEW);
        when(documentRepository.countPublicChildrenByParentIds(any())).thenReturn(List.of());

        DocumentResponse response = documentService.getPublic(docId);

        // A non-public child must not reveal itself through the parent flag.
        assertFalse(response.hasChildren());
        verify(documentRepository, never()).existsNonTrashedChildrenByParentId(docId);
    }

    @Test
    void update_stillReportsCollaboratorsToSignedInCallers() {
        UUID requesterId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = createSharedDocument(documentId, DocumentAccessLevel.EDIT);

        when(documentRepository.findById(documentId)).thenReturn(Optional.of(document));
        when(permissionService.resolveAccess(requesterId, documentId)).thenReturn(DocumentAccessLevel.EDIT);
        when(documentRepository.save(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(collaboratorRepository.existsByDocument_Id(documentId)).thenReturn(true);

        DocumentResponse response =
                documentService.update(requesterId, documentId, new DocumentUpdateRequest("Updated title", null, null));

        assertTrue(response.hasCollaborators());
    }

    @Test
    void update_titleLongerThanTheColumn_throwsValidationFailed() {
        UUID requesterId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = createSharedDocument(documentId, DocumentAccessLevel.EDIT);

        when(documentRepository.findById(documentId)).thenReturn(Optional.of(document));
        when(permissionService.resolveAccess(requesterId, documentId)).thenReturn(DocumentAccessLevel.EDIT);

        String tooLong = "t".repeat(DocumentService.MAX_TITLE_LENGTH + 1);

        // The DTO's @Size already rejects this over HTTP; the service guard keeps the
        // VARCHAR(255) invariant for every other caller instead of failing at the column.
        ApiException exception = assertThrows(
                ApiException.class,
                () -> documentService.update(requesterId, documentId, new DocumentUpdateRequest(tooLong, null, null)));

        assertEquals(ErrorCode.VALIDATION_FAILED, exception.getErrorCode());
        verify(documentRepository, never()).save(any(Document.class));
    }

    @Test
    void update_titleAtTheColumnLimit_isAccepted() {
        UUID requesterId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = createSharedDocument(documentId, DocumentAccessLevel.EDIT);

        when(documentRepository.findById(documentId)).thenReturn(Optional.of(document));
        when(permissionService.resolveAccess(requesterId, documentId)).thenReturn(DocumentAccessLevel.EDIT);
        when(documentRepository.save(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));

        String longest = "t".repeat(DocumentService.MAX_TITLE_LENGTH);

        DocumentResponse response =
                documentService.update(requesterId, documentId, new DocumentUpdateRequest(longest, null, null));

        assertEquals(longest, response.title());
    }

    @Test
    void update_oversizedState_throwsValidationFailed() {
        UUID requesterId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = createSharedDocument(documentId, DocumentAccessLevel.EDIT);

        when(documentRepository.findById(documentId)).thenReturn(Optional.of(document));
        when(permissionService.resolveAccess(requesterId, documentId)).thenReturn(DocumentAccessLevel.EDIT);

        byte[] oversized = new byte[DocumentService.MAX_PUBLIC_STATE_BYTES + 1];
        String encodedState = java.util.Base64.getEncoder().encodeToString(oversized);

        ApiException ex = assertThrows(
                ApiException.class,
                () -> documentService.update(
                        requesterId, documentId, new DocumentUpdateRequest(null, encodedState, null)));

        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
        verify(documentRepository, never()).save(any(Document.class));
    }

    @Test
    void updatePublic_titleLongerThanTheColumn_throwsValidationFailed() {
        UUID docId = UUID.randomUUID();
        Document doc = createSharedDocument(docId, DocumentAccessLevel.EDIT);

        when(documentRepository.findByIdAndDeletedAtIsNull(docId)).thenReturn(Optional.of(doc));
        when(permissionService.resolvePublicAccess(docId)).thenReturn(DocumentAccessLevel.EDIT);

        String tooLong = "t".repeat(DocumentService.MAX_TITLE_LENGTH + 1);

        ApiException exception = assertThrows(
                ApiException.class,
                () -> documentService.updatePublic(docId, new DocumentUpdateRequest(tooLong, null, null)));

        assertEquals(ErrorCode.VALIDATION_FAILED, exception.getErrorCode());
        verify(documentRepository, never()).save(any());
    }

    @Test
    void updatePublic_editLink_updatesTitleAndState() {
        UUID docId = UUID.randomUUID();
        Document doc = createSharedDocument(docId, DocumentAccessLevel.EDIT);

        when(documentRepository.findByIdAndDeletedAtIsNull(docId)).thenReturn(Optional.of(doc));
        when(permissionService.resolvePublicAccess(docId)).thenReturn(DocumentAccessLevel.EDIT);
        when(documentRepository.save(doc)).thenReturn(doc);
        when(documentRepository.countPublicChildrenByParentIds(any())).thenReturn(List.of());

        String encodedState = java.util.Base64.getEncoder().encodeToString("edit".getBytes(StandardCharsets.UTF_8));
        DocumentResponse response =
                documentService.updatePublic(docId, new DocumentUpdateRequest("Guest edit", encodedState, "Guest"));

        assertEquals("Guest edit", response.title());
        // Guest creator labels are not adopted for public saves.
        assertNull(doc.getCreatedBy());
    }

    @Test
    void updatePublic_oversizedState_throwsValidationFailed() {
        UUID docId = UUID.randomUUID();
        Document doc = createSharedDocument(docId, DocumentAccessLevel.EDIT);

        when(documentRepository.findByIdAndDeletedAtIsNull(docId)).thenReturn(Optional.of(doc));
        when(permissionService.resolvePublicAccess(docId)).thenReturn(DocumentAccessLevel.EDIT);

        byte[] oversized = new byte[DocumentService.MAX_PUBLIC_STATE_BYTES + 1];
        String encodedState = java.util.Base64.getEncoder().encodeToString(oversized);

        ApiException ex = assertThrows(
                ApiException.class,
                () -> documentService.updatePublic(docId, new DocumentUpdateRequest("Too big", encodedState, null)));

        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
        verify(documentRepository, never()).save(any());
    }

    @Test
    void updatePublic_stateAtTheExactByteLimit_isAccepted() {
        UUID docId = UUID.randomUUID();
        Document doc = createSharedDocument(docId, DocumentAccessLevel.EDIT);

        when(documentRepository.findByIdAndDeletedAtIsNull(docId)).thenReturn(Optional.of(doc));
        when(permissionService.resolvePublicAccess(docId)).thenReturn(DocumentAccessLevel.EDIT);
        when(documentRepository.save(doc)).thenReturn(doc);
        when(documentRepository.countPublicChildrenByParentIds(any())).thenReturn(List.of());

        // Exactly at the cap, not one byte over: the bound is inclusive, so a snapshot
        // the realtime layer accepts can always be persisted through the API.
        byte[] atLimit = new byte[DocumentService.MAX_PUBLIC_STATE_BYTES];
        String encodedState = java.util.Base64.getEncoder().encodeToString(atLimit);

        documentService.updatePublic(docId, new DocumentUpdateRequest(null, encodedState, null));

        assertEquals(DocumentService.MAX_PUBLIC_STATE_BYTES, doc.getYjsState().length);
    }

    @Test
    void updatePublic_malformedOversizedState_rejectsOnSizeBeforeDecoding() {
        UUID docId = UUID.randomUUID();
        Document doc = createSharedDocument(docId, DocumentAccessLevel.EDIT);

        when(documentRepository.findByIdAndDeletedAtIsNull(docId)).thenReturn(Optional.of(doc));
        when(permissionService.resolvePublicAccess(docId)).thenReturn(DocumentAccessLevel.EDIT);

        // Not valid base64, so a decode-first implementation would report "must be valid
        // base64" instead of the size violation. The size message proves the oversized
        // payload was rejected without ever being decoded.
        String oversizedGarbage = "!".repeat(DocumentService.MAX_PUBLIC_STATE_ENCODED_LENGTH + 1);

        ApiException ex = assertThrows(
                ApiException.class,
                () -> documentService.updatePublic(
                        docId, new DocumentUpdateRequest("Too big", oversizedGarbage, null)));

        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
        assertTrue(ex.getMessage().contains("exceeds the maximum size"));
        verify(documentRepository, never()).save(any());
    }

    @Test
    void updatePublic_viewLink_throwsForbidden() {
        UUID docId = UUID.randomUUID();
        Document doc = createSharedDocument(docId, DocumentAccessLevel.VIEW);

        when(documentRepository.findByIdAndDeletedAtIsNull(docId)).thenReturn(Optional.of(doc));
        when(permissionService.resolvePublicAccess(docId)).thenReturn(DocumentAccessLevel.VIEW);

        ApiException ex = assertThrows(
                ApiException.class,
                () -> documentService.updatePublic(docId, new DocumentUpdateRequest("Nope", null, null)));
        assertEquals(ErrorCode.FORBIDDEN, ex.getErrorCode());
    }

    @Test
    void updatePublic_commentLink_throwsForbidden() {
        UUID docId = UUID.randomUUID();
        Document doc = createSharedDocument(docId, DocumentAccessLevel.COMMENT);

        when(documentRepository.findByIdAndDeletedAtIsNull(docId)).thenReturn(Optional.of(doc));
        when(permissionService.resolvePublicAccess(docId)).thenReturn(DocumentAccessLevel.COMMENT);

        ApiException ex = assertThrows(
                ApiException.class,
                () -> documentService.updatePublic(docId, new DocumentUpdateRequest("Nope", null, null)));
        assertEquals(ErrorCode.FORBIDDEN, ex.getErrorCode());
    }

    @Test
    void updatePublic_privateDoc_throwsNotFound() {
        UUID docId = UUID.randomUUID();
        Document doc = createSharedDocument(docId, DocumentAccessLevel.VIEW);

        when(documentRepository.findByIdAndDeletedAtIsNull(docId)).thenReturn(Optional.of(doc));
        when(permissionService.resolvePublicAccess(docId)).thenReturn(null);

        ApiException ex = assertThrows(
                ApiException.class,
                () -> documentService.updatePublic(docId, new DocumentUpdateRequest("Nope", null, null)));
        assertEquals(ErrorCode.NOT_FOUND, ex.getErrorCode());
    }

    @Test
    void listPublicChildren_publicParent_returnsOnlyPublicChildren() {
        UUID parentId = UUID.randomUUID();
        Document parent = createSharedDocument(parentId, DocumentAccessLevel.VIEW);

        Document child = createSharedDocument(UUID.randomUUID(), DocumentAccessLevel.EDIT);
        child.setParent(parent);

        when(documentRepository.findByIdAndDeletedAtIsNull(parentId)).thenReturn(Optional.of(parent));
        when(permissionService.resolvePublicAccess(parentId)).thenReturn(DocumentAccessLevel.VIEW);
        when(documentRepository.findPublicChildren(eq(parentId), any())).thenReturn(new PageImpl<>(List.of(child)));
        when(documentRepository.countPublicChildrenByParentIds(any())).thenReturn(List.of());
        when(permissionService.resolvePublicAccessBatch(any()))
                .thenReturn(Map.of(child.getId(), DocumentAccessLevel.EDIT));

        Page<DocumentResponse> page =
                documentService.listPublicChildren(parentId, org.springframework.data.domain.PageRequest.of(0, 50));

        assertEquals(1, page.getTotalElements());
        assertEquals(DocumentAccessLevel.EDIT, page.getContent().get(0).accessLevel());
        assertFalse(page.getContent().get(0).hasCollaborators());
        assertFalse(page.getContent().get(0).hasChildren());
    }

    @Test
    void listPublicChildren_clampsOversizedPageRequestToCap() {
        UUID parentId = UUID.randomUUID();
        Document parent = createSharedDocument(parentId, DocumentAccessLevel.VIEW);

        when(documentRepository.findByIdAndDeletedAtIsNull(parentId)).thenReturn(Optional.of(parent));
        when(permissionService.resolvePublicAccess(parentId)).thenReturn(DocumentAccessLevel.VIEW);
        when(documentRepository.findPublicChildren(eq(parentId), any())).thenReturn(new PageImpl<>(List.of()));

        documentService.listPublicChildren(parentId, org.springframework.data.domain.PageRequest.of(0, 5000));

        ArgumentCaptor<org.springframework.data.domain.Pageable> pageableCaptor =
                ArgumentCaptor.forClass(org.springframework.data.domain.Pageable.class);
        verify(documentRepository).findPublicChildren(eq(parentId), pageableCaptor.capture());
        assertEquals(
                DocumentService.MAX_PUBLIC_CHILDREN_PAGE_SIZE,
                pageableCaptor.getValue().getPageSize());
    }

    @Test
    void listPublicChildren_privateParent_throwsNotFound() {
        UUID parentId = UUID.randomUUID();
        Document parent = createSharedDocument(parentId, DocumentAccessLevel.VIEW);
        parent.setGeneralAccessMode(DocumentGeneralAccessMode.RESTRICTED);

        when(documentRepository.findByIdAndDeletedAtIsNull(parentId)).thenReturn(Optional.of(parent));
        when(permissionService.resolvePublicAccess(parentId)).thenReturn(null);

        ApiException ex = assertThrows(
                ApiException.class,
                () -> documentService.listPublicChildren(
                        parentId, org.springframework.data.domain.PageRequest.of(0, 50)));
        assertEquals(ErrorCode.NOT_FOUND, ex.getErrorCode());
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
