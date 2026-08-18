package com.nextdocs.api.document.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.dto.request.DocumentMoveRequest;
import com.nextdocs.api.document.dto.response.DocumentResponse;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.entity.DocumentCollaborator;
import com.nextdocs.api.document.entity.UserDocumentOrder;
import com.nextdocs.api.document.repository.DocumentCollaboratorRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.repository.UserDocumentOrderRepository;
import java.time.OffsetDateTime;
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
class DocumentTreeServiceTest {

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

    private DocumentTreeService documentTreeService;

    private UUID userId;
    private User user;

    @BeforeEach
    void setUp() {
        userId = UUID.randomUUID();
        user = User.builder()
                .id(userId)
                .email("alice@example.com")
                .displayName("Alice")
                .build();
        documentTreeService = new DocumentTreeService(
                documentRepository,
                collaboratorRepository,
                userDocumentOrderRepository,
                userRepository,
                permissionService);
    }

    @Test
    void move_reparent_deletesOwnerUserDocumentOrder_andPreservesCollaboratorOrders() {
        UUID docId = UUID.randomUUID();
        UUID parentId = UUID.randomUUID();
        UUID prevSiblingId = UUID.randomUUID();
        UUID nextSiblingId = UUID.randomUUID();

        Document doc = Document.builder()
                .id(docId)
                .user(user)
                .title("Doc")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        Document parent =
                Document.builder().id(parentId).user(user).title("Parent").build();

        DocumentMoveRequest request = new DocumentMoveRequest(parentId, prevSiblingId, nextSiblingId);

        when(permissionService.requireEditAccess(userId, docId)).thenReturn(doc);
        when(permissionService.requireEditAccess(userId, parentId)).thenReturn(parent);
        when(documentRepository.findByIdAndDeletedAtIsNull(parentId)).thenReturn(Optional.of(parent));
        Document prevSibling = Document.builder()
                .id(prevSiblingId)
                .parent(parent)
                .siblingOrderKey("a0")
                .build();
        Document nextSibling = Document.builder()
                .id(nextSiblingId)
                .parent(parent)
                .siblingOrderKey("a2")
                .build();
        when(documentRepository.findByIdAndDeletedAtIsNull(prevSiblingId)).thenReturn(Optional.of(prevSibling));
        when(documentRepository.findByIdAndDeletedAtIsNull(nextSiblingId)).thenReturn(Optional.of(nextSibling));
        when(documentRepository.saveAndFlush(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(documentRepository.existsNonTrashedChildrenByParentId(docId)).thenReturn(false);

        DocumentResponse result = documentTreeService.move(userId, docId, request);

        assertNotNull(result.orderKey());
        assertTrue(result.orderKey().compareTo("a0") > 0);
        assertTrue(result.orderKey().compareTo("a2") < 0);
        assertEquals(parentId, result.parentId());

        // Verify document was updated with new parent and sibling order key
        verify(documentRepository).saveAndFlush(any(Document.class));

        // Verify ONLY owner root order was deleted, preserving collaborator Shared orders
        verify(userDocumentOrderRepository).deleteByUser_IdAndDocument_Id(user.getId(), docId);
        verify(userDocumentOrderRepository, never()).deleteByDocument_Id(docId);
    }

    @Test
    void move_reorderSharedNavigationByCollaborator_updatesOnlyCallerUserDocumentOrder() {
        UUID docId = UUID.randomUUID();
        UUID prevSiblingId = UUID.randomUUID();
        User owner = User.builder().id(UUID.randomUUID()).build();

        Document doc = Document.builder()
                .id(docId)
                .user(owner) // Document is owned by someone else
                .title("Shared Doc")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        Document prevSibling =
                Document.builder().id(prevSiblingId).user(owner).title("Prev").build();
        DocumentMoveRequest request = new DocumentMoveRequest(null, prevSiblingId, null);

        when(documentRepository.findByIdAndDeletedAtIsNull(docId)).thenReturn(Optional.of(doc));
        when(permissionService.requireReadAccess(userId, docId)).thenReturn(doc);
        when(documentRepository.findByIdAndDeletedAtIsNull(prevSiblingId)).thenReturn(Optional.of(prevSibling));
        when(permissionService.resolveAccess(userId, prevSiblingId)).thenReturn(DocumentAccessLevel.VIEW);
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(userDocumentOrderRepository.findOrderKeyByUserIdAndDocumentId(userId, prevSiblingId))
                .thenReturn(Optional.of("a0"));
        when(userDocumentOrderRepository.findMinOrderKeyGreaterThan(eq(userId), eq("a0"), eq(docId)))
                .thenReturn(Optional.empty());
        when(userDocumentOrderRepository.findByUser_IdAndDocument_Id(userId, docId))
                .thenReturn(Optional.empty());
        when(userDocumentOrderRepository.saveAndFlush(any(UserDocumentOrder.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));
        when(permissionService.resolveAccess(userId, docId)).thenReturn(DocumentAccessLevel.VIEW);

        DocumentResponse result = documentTreeService.move(userId, docId, request);

        assertNull(result.parentId());
        assertNotNull(result.orderKey());
        assertTrue(result.orderKey().compareTo("a0") > 0);
        assertEquals(DocumentAccessLevel.VIEW, result.accessLevel());

        // Verify ONLY userDocumentOrder was saved, and Document was NOT modified/saved!
        verify(userDocumentOrderRepository).saveAndFlush(any(UserDocumentOrder.class));
        verify(documentRepository, times(0)).saveAndFlush(any(Document.class));
    }

    @Test
    void move_collaboratorReordersFloatedNestedDocument_withoutReparenting() {
        UUID docId = UUID.randomUUID();
        UUID prevSiblingId = UUID.randomUUID();
        UUID parentId = UUID.randomUUID();
        User owner = User.builder().id(UUID.randomUUID()).build();
        Document parent =
                Document.builder().id(parentId).user(owner).title("Parent").build();

        // Real parent is not shared with the caller, so the frontend floats the
        // document at the root of the Shared section.
        Document doc = Document.builder()
                .id(docId)
                .user(owner)
                .title("Nested Shared Doc")
                .parent(parent)
                .siblingOrderKey("a1")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        Document prevSibling =
                Document.builder().id(prevSiblingId).user(owner).title("Prev").build();
        DocumentMoveRequest request = new DocumentMoveRequest(null, prevSiblingId, null);

        when(documentRepository.findByIdAndDeletedAtIsNull(docId)).thenReturn(Optional.of(doc));
        when(permissionService.requireReadAccess(userId, docId)).thenReturn(doc);
        when(documentRepository.findByIdAndDeletedAtIsNull(prevSiblingId)).thenReturn(Optional.of(prevSibling));
        when(permissionService.resolveAccess(userId, prevSiblingId)).thenReturn(DocumentAccessLevel.VIEW);
        when(userDocumentOrderRepository.findOrderKeyByUserIdAndDocumentId(userId, prevSiblingId))
                .thenReturn(Optional.of("a0"));
        when(userDocumentOrderRepository.findMinOrderKeyGreaterThan(eq(userId), eq("a0"), eq(docId)))
                .thenReturn(Optional.empty());
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(userDocumentOrderRepository.findByUser_IdAndDocument_Id(userId, docId))
                .thenReturn(Optional.empty());
        when(userDocumentOrderRepository.saveAndFlush(any(UserDocumentOrder.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));
        when(documentRepository.existsNonTrashedChildrenByParentId(docId)).thenReturn(false);
        when(permissionService.resolveAccess(userId, docId)).thenReturn(DocumentAccessLevel.EDIT);

        DocumentResponse result = documentTreeService.move(userId, docId, request);

        assertEquals(parentId, result.parentId());
        assertNotNull(result.orderKey());
        assertTrue(result.orderKey().compareTo("a0") > 0);

        // A collaborator reorder must NOT un-parent the document.
        verify(documentRepository, times(0)).saveAndFlush(any(Document.class));
        verify(userDocumentOrderRepository).saveAndFlush(any(UserDocumentOrder.class));
    }

    @Test
    void move_collaboratorReorderWithFloatedSibling_lazilyCreatesSiblingOrder() {
        UUID docId = UUID.randomUUID();
        UUID prevSiblingId = UUID.randomUUID();
        User owner = User.builder().id(UUID.randomUUID()).build();

        Document doc = Document.builder()
                .id(docId)
                .user(owner)
                .title("Shared Doc")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        // Floated sibling has no UserDocumentOrder row yet.
        Document floatedSibling = Document.builder()
                .id(prevSiblingId)
                .user(owner)
                .title("Floated Sibling")
                .build();

        DocumentMoveRequest request = new DocumentMoveRequest(null, prevSiblingId, null);

        when(documentRepository.findByIdAndDeletedAtIsNull(docId)).thenReturn(Optional.of(doc));
        when(permissionService.requireReadAccess(userId, docId)).thenReturn(doc);
        when(documentRepository.findByIdAndDeletedAtIsNull(prevSiblingId)).thenReturn(Optional.of(floatedSibling));
        when(permissionService.resolveAccess(userId, prevSiblingId)).thenReturn(DocumentAccessLevel.VIEW);
        when(userDocumentOrderRepository.findOrderKeyByUserIdAndDocumentId(userId, prevSiblingId))
                .thenReturn(Optional.empty());
        when(userDocumentOrderRepository.findMinOrderKeyByUserId(userId, prevSiblingId))
                .thenReturn(Optional.of("b5"));
        when(userDocumentOrderRepository.findMinOrderKeyGreaterThan(eq(userId), anyString(), eq(docId)))
                .thenReturn(Optional.empty());
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(userDocumentOrderRepository.findByUser_IdAndDocument_Id(userId, docId))
                .thenReturn(Optional.empty());
        when(userDocumentOrderRepository.saveAndFlush(any(UserDocumentOrder.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));
        when(documentRepository.existsNonTrashedChildrenByParentId(docId)).thenReturn(false);
        when(permissionService.resolveAccess(userId, docId)).thenReturn(DocumentAccessLevel.VIEW);

        DocumentResponse result = documentTreeService.move(userId, docId, request);

        assertNotNull(result.orderKey());
        // One row for the lazily-created sibling order, one for the moved doc.
        verify(userDocumentOrderRepository, times(2)).saveAndFlush(any(UserDocumentOrder.class));
    }

    @Test
    void move_collaboratorReordersSharedToMeDocBetweenOwnerSharedDocs_updatesOnlyCallerOrder() {
        UUID docId = UUID.randomUUID(); // Shared to me doc
        UUID prevSiblingId = UUID.randomUUID(); // Owned by caller & shared with others
        UUID nextSiblingId = UUID.randomUUID(); // Owned by caller & shared with others
        UUID ownerId = UUID.randomUUID();
        User owner = User.builder().id(ownerId).build();

        Document doc = Document.builder()
                .id(docId)
                .user(owner) // Document is owned by owner (not caller)
                .title("Shared To Me Doc")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        Document prevSibling =
                Document.builder().id(prevSiblingId).user(user).title("Prev").build();
        Document nextSibling =
                Document.builder().id(nextSiblingId).user(user).title("Next").build();
        DocumentMoveRequest request = new DocumentMoveRequest(null, prevSiblingId, nextSiblingId);

        when(documentRepository.findByIdAndDeletedAtIsNull(docId)).thenReturn(Optional.of(doc));
        when(permissionService.requireReadAccess(userId, docId)).thenReturn(doc);
        when(documentRepository.findByIdAndDeletedAtIsNull(prevSiblingId)).thenReturn(Optional.of(prevSibling));
        when(documentRepository.findByIdAndDeletedAtIsNull(nextSiblingId)).thenReturn(Optional.of(nextSibling));
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        // Caller has order keys for both owned shared siblings: "a0" and "a2"
        when(userDocumentOrderRepository.findOrderKeyByUserIdAndDocumentId(userId, prevSiblingId))
                .thenReturn(Optional.of("a0"));
        when(userDocumentOrderRepository.findOrderKeyByUserIdAndDocumentId(userId, nextSiblingId))
                .thenReturn(Optional.of("a2"));
        when(userDocumentOrderRepository.findMinOrderKeyGreaterThan(eq(userId), eq("a0"), eq(docId)))
                .thenReturn(Optional.of("a2"));
        when(userDocumentOrderRepository.findByUser_IdAndDocument_Id(userId, docId))
                .thenReturn(Optional.empty());
        when(userDocumentOrderRepository.saveAndFlush(any(UserDocumentOrder.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));
        when(permissionService.resolveAccess(userId, docId)).thenReturn(DocumentAccessLevel.VIEW);
        when(documentRepository.existsNonTrashedChildrenByParentId(docId)).thenReturn(false);

        DocumentResponse result = documentTreeService.move(userId, docId, request);

        assertNull(result.parentId());
        assertNotNull(result.orderKey());
        // Generated key should be strictly between a0 and a2
        assertTrue(result.orderKey().compareTo("a0") > 0);
        assertTrue(result.orderKey().compareTo("a2") < 0);
        assertEquals(DocumentAccessLevel.VIEW, result.accessLevel());

        // Verify ONLY userDocumentOrder for userId was saved, Document and owner's orders were never touched
        ArgumentCaptor<UserDocumentOrder> captor = ArgumentCaptor.forClass(UserDocumentOrder.class);
        verify(userDocumentOrderRepository).saveAndFlush(captor.capture());
        assertEquals(userId, captor.getValue().getUser().getId());
        assertEquals(docId, captor.getValue().getDocument().getId());
        verify(documentRepository, times(0)).saveAndFlush(any(Document.class));
    }

    @Test
    void move_crossTree_adoptsHostOwnerForMovedSubtree() {
        UUID docId = UUID.randomUUID();
        UUID childDocId = UUID.randomUUID();
        UUID hostParentId = UUID.randomUUID();
        User host = User.builder().id(UUID.randomUUID()).build();

        Document doc = Document.builder()
                .id(docId)
                .user(user)
                .title("Moving subtree")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();
        Document child = Document.builder()
                .id(childDocId)
                .user(user)
                .parent(doc)
                .title("Child")
                .build();
        Document hostParent = Document.builder()
                .id(hostParentId)
                .user(host)
                .title("Host parent")
                .build();

        when(permissionService.requireEditAccess(userId, docId)).thenReturn(doc);
        when(permissionService.requireEditAccess(userId, hostParentId)).thenReturn(hostParent);
        when(documentRepository.findByIdAndDeletedAtIsNull(hostParentId)).thenReturn(Optional.of(hostParent));
        when(documentRepository.findMaxSiblingOrderKey(hostParentId, docId)).thenReturn(Optional.empty());
        when(documentRepository.findAllByParent_IdIn(List.of(docId))).thenReturn(List.of(child));
        when(documentRepository.findAllByParent_IdIn(List.of(childDocId))).thenReturn(List.of());
        when(documentRepository.saveAndFlush(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(documentRepository.existsNonTrashedChildrenByParentId(docId)).thenReturn(false);
        when(permissionService.resolveAccess(userId, docId)).thenReturn(DocumentAccessLevel.EDIT);

        documentTreeService.move(userId, docId, new DocumentMoveRequest(hostParentId, null, null));

        // Location authority: moved doc and its descendants now belong to the host tree owner.
        assertEquals(host.getId(), doc.getUser().getId());
        assertEquals(host.getId(), child.getUser().getId());
        verify(documentRepository).saveAll(anyList());
        verify(userDocumentOrderRepository).deleteByUser_IdAndDocument_Id(host.getId(), docId);
        verify(userDocumentOrderRepository).deleteByUser_IdAndDocument_Id(user.getId(), docId);
        verify(userDocumentOrderRepository, never()).deleteByDocument_Id(docId);
    }

    @Test
    void move_sameTree_reparentKeepsOwnership() {
        UUID docId = UUID.randomUUID();
        UUID parentId = UUID.randomUUID();

        Document doc = Document.builder()
                .id(docId)
                .user(user)
                .title("Doc")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();
        Document parent =
                Document.builder().id(parentId).user(user).title("Parent").build();

        when(permissionService.requireEditAccess(userId, docId)).thenReturn(doc);
        when(permissionService.requireEditAccess(userId, parentId)).thenReturn(parent);
        when(documentRepository.findByIdAndDeletedAtIsNull(parentId)).thenReturn(Optional.of(parent));
        when(documentRepository.findMaxSiblingOrderKey(parentId, docId)).thenReturn(Optional.empty());
        when(documentRepository.saveAndFlush(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(documentRepository.existsNonTrashedChildrenByParentId(docId)).thenReturn(false);

        documentTreeService.move(userId, docId, new DocumentMoveRequest(parentId, null, null));

        // Intra-tree reparenting never touches ownership; no cascade walk happens.
        assertEquals(user.getId(), doc.getUser().getId());
        verify(documentRepository, never()).saveAll(anyList());
    }

    @Test
    void move_cycleDetected_throwsValidationFailed() {
        UUID docId = UUID.randomUUID();
        UUID childId = UUID.randomUUID();

        Document doc = Document.builder().id(docId).user(user).title("Doc").build();

        Document child = Document.builder()
                .id(childId)
                .user(user)
                .title("Child")
                .parent(doc)
                .siblingOrderKey("a1")
                .build();

        DocumentMoveRequest request = new DocumentMoveRequest(childId, null, null);

        when(permissionService.requireEditAccess(userId, docId)).thenReturn(doc);
        when(documentRepository.findByIdAndDeletedAtIsNull(childId)).thenReturn(Optional.of(child));

        ApiException ex = assertThrows(ApiException.class, () -> documentTreeService.move(userId, docId, request));
        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
    }

    @Test
    void move_selfAsSibling_throwsValidationFailed() {
        UUID docId = UUID.randomUUID();

        Document doc = Document.builder().id(docId).user(user).title("Doc").build();

        DocumentMoveRequest request = new DocumentMoveRequest(null, docId, null);

        when(documentRepository.findByIdAndDeletedAtIsNull(docId)).thenReturn(Optional.of(doc));
        when(permissionService.requireEditAccess(userId, docId)).thenReturn(doc);

        ApiException ex = assertThrows(ApiException.class, () -> documentTreeService.move(userId, docId, request));
        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
    }

    @Test
    void move_depthExceeds100_throwsValidationFailed() {
        UUID docId = UUID.randomUUID();
        UUID targetParentId = UUID.randomUUID();

        Document doc = Document.builder().id(docId).user(user).title("Doc").build();

        UUID currentId = targetParentId;
        for (int i = 0; i < 100; i++) {
            UUID nextParentId = UUID.randomUUID();
            Document parentDoc = Document.builder()
                    .id(currentId)
                    .user(user)
                    .parent(Document.builder().id(nextParentId).build())
                    .build();
            when(documentRepository.findByIdAndDeletedAtIsNull(currentId)).thenReturn(Optional.of(parentDoc));
            currentId = nextParentId;
        }

        DocumentMoveRequest request = new DocumentMoveRequest(targetParentId, null, null);

        when(permissionService.requireEditAccess(userId, docId)).thenReturn(doc);

        ApiException ex = assertThrows(ApiException.class, () -> documentTreeService.move(userId, docId, request));
        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
        assertTrue(ex.getMessage().contains("Ancestor chain is too deep"));
    }

    @Test
    void move_concurrentCollision_reindexesAndRetries() {
        UUID docId = UUID.randomUUID();
        UUID parentId = UUID.randomUUID();

        Document doc = Document.builder()
                .id(docId)
                .user(user)
                .title("Doc")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        Document parent =
                Document.builder().id(parentId).user(user).title("Parent").build();

        DocumentMoveRequest request = new DocumentMoveRequest(parentId, null, null);

        when(permissionService.requireEditAccess(userId, docId)).thenReturn(doc);
        when(permissionService.requireEditAccess(userId, parentId)).thenReturn(parent);
        when(documentRepository.findByIdAndDeletedAtIsNull(parentId)).thenReturn(Optional.of(parent));
        when(documentRepository.findMaxSiblingOrderKey(parentId, docId)).thenReturn(Optional.of("a5"));
        when(documentRepository.findAllSiblingsForReindex(parentId)).thenReturn(List.of());
        when(documentRepository.saveAndFlush(any(Document.class)))
                .thenThrow(new DataIntegrityViolationException("sibling_order_key unique violation"))
                .thenAnswer(invocation -> invocation.getArgument(0));
        when(documentRepository.existsNonTrashedChildrenByParentId(docId)).thenReturn(false);

        DocumentResponse result = documentTreeService.move(userId, docId, request);

        verify(documentRepository, times(2)).saveAndFlush(any(Document.class));
        assertNotNull(result.orderKey());
    }

    @Test
    void move_nestedToRoot_recreatesOrderForCollaborators() {
        UUID docId = UUID.randomUUID();
        UUID parentId = UUID.randomUUID();
        UUID collaboratorId = UUID.randomUUID();

        Document parent =
                Document.builder().id(parentId).user(user).title("Parent").build();
        Document doc = Document.builder()
                .id(docId)
                .user(user)
                .title("Doc")
                .parent(parent)
                .siblingOrderKey("a1")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        User collaboratorUser = User.builder().id(collaboratorId).build();
        DocumentCollaborator collaborator = DocumentCollaborator.builder()
                .user(collaboratorUser)
                .document(doc)
                .accessLevel(DocumentAccessLevel.VIEW)
                .build();

        DocumentMoveRequest request = new DocumentMoveRequest(null, null, null);

        when(permissionService.requireEditAccess(userId, docId)).thenReturn(doc);
        when(documentRepository.findByIdAndDeletedAtIsNull(docId)).thenReturn(Optional.of(doc));
        when(documentRepository.saveAndFlush(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(userDocumentOrderRepository.findByUser_IdAndDocument_Id(userId, docId))
                .thenReturn(Optional.empty());
        when(userDocumentOrderRepository.findMaxOrderKeyByUserId(userId, docId)).thenReturn(Optional.of("a5"));
        when(collaboratorRepository.findAllByDocument_Id(docId)).thenReturn(List.of(collaborator));
        when(userDocumentOrderRepository.existsByUser_IdAndDocument_Id(collaboratorId, docId))
                .thenReturn(false);
        when(userDocumentOrderRepository.findMinOrderKeyByUserId(collaboratorId, docId))
                .thenReturn(Optional.of("a7"));
        when(userDocumentOrderRepository.saveAndFlush(any(UserDocumentOrder.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));
        when(documentRepository.existsNonTrashedChildrenByParentId(docId)).thenReturn(false);

        DocumentResponse result = documentTreeService.move(userId, docId, request);

        assertNull(result.parentId());
        assertNotNull(result.orderKey());

        ArgumentCaptor<UserDocumentOrder> captor = ArgumentCaptor.forClass(UserDocumentOrder.class);
        verify(userDocumentOrderRepository, times(2)).saveAndFlush(captor.capture());
        List<UserDocumentOrder> saved = captor.getAllValues();
        assertTrue(saved.stream().anyMatch(o -> o.getUser().getId().equals(collaboratorId)));
        assertTrue(saved.stream()
                .filter(o -> o.getUser().getId().equals(collaboratorId))
                .allMatch(o -> o.getOrderKey().compareTo("a7") < 0));
    }

    @Test
    void move_rootReorderByLinkOnlyUser_throwsForbidden() {
        UUID docId = UUID.randomUUID();
        User owner = User.builder().id(UUID.randomUUID()).build();

        Document doc = Document.builder()
                .id(docId)
                .user(owner)
                .title("Shared Doc")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        DocumentMoveRequest request = new DocumentMoveRequest(null, null, null);

        when(documentRepository.findByIdAndDeletedAtIsNull(docId)).thenReturn(Optional.of(doc));
        when(permissionService.requireReadAccess(userId, docId)).thenThrow(new ApiException(ErrorCode.NOT_FOUND));

        ApiException ex = assertThrows(ApiException.class, () -> documentTreeService.move(userId, docId, request));
        assertEquals(ErrorCode.NOT_FOUND, ex.getErrorCode());
    }

    @Test
    void move_rootReorderCollision_reindexesUserOrdersAndRetries() {
        UUID docId = UUID.randomUUID();
        UUID prevSiblingId = UUID.randomUUID();
        User owner = User.builder().id(UUID.randomUUID()).build();

        Document doc = Document.builder()
                .id(docId)
                .user(owner)
                .title("Shared Doc")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        Document prevSibling =
                Document.builder().id(prevSiblingId).user(owner).title("Prev").build();
        DocumentMoveRequest request = new DocumentMoveRequest(null, prevSiblingId, null);

        when(documentRepository.findByIdAndDeletedAtIsNull(docId)).thenReturn(Optional.of(doc));
        when(permissionService.requireReadAccess(userId, docId)).thenReturn(doc);
        when(documentRepository.findByIdAndDeletedAtIsNull(prevSiblingId)).thenReturn(Optional.of(prevSibling));
        when(permissionService.resolveAccess(userId, prevSiblingId)).thenReturn(DocumentAccessLevel.VIEW);
        when(userDocumentOrderRepository.findOrderKeyByUserIdAndDocumentId(userId, prevSiblingId))
                .thenReturn(Optional.of("a0"));
        when(userDocumentOrderRepository.findMinOrderKeyGreaterThan(eq(userId), eq("a0"), eq(docId)))
                .thenReturn(Optional.empty());
        when(userDocumentOrderRepository.findAllForReindex(userId)).thenReturn(List.of());
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(userDocumentOrderRepository.findByUser_IdAndDocument_Id(userId, docId))
                .thenReturn(Optional.empty());
        when(userDocumentOrderRepository.saveAndFlush(any(UserDocumentOrder.class)))
                .thenThrow(new DataIntegrityViolationException("order_key unique violation"))
                .thenAnswer(invocation -> invocation.getArgument(0));
        when(documentRepository.existsNonTrashedChildrenByParentId(docId)).thenReturn(false);
        when(permissionService.resolveAccess(userId, docId)).thenReturn(DocumentAccessLevel.VIEW);

        DocumentResponse result = documentTreeService.move(userId, docId, request);

        assertNotNull(result.orderKey());
        verify(userDocumentOrderRepository, times(2)).saveAndFlush(any(UserDocumentOrder.class));
        verify(userDocumentOrderRepository).findAllForReindex(userId);
    }

    @Test
    void move_rootReorderWithInterleavedKeys_placesDocumentInFreeSlotWithoutCollision() {
        UUID docId = UUID.randomUUID();
        UUID prevSiblingId = UUID.randomUUID();
        UUID nextSiblingId = UUID.randomUUID();
        User owner = User.builder().id(UUID.randomUUID()).build();

        Document doc = Document.builder()
                .id(docId)
                .user(owner)
                .title("Shared Doc")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        Document prevSibling =
                Document.builder().id(prevSiblingId).user(owner).title("Prev").build();
        Document nextSibling =
                Document.builder().id(nextSiblingId).user(owner).title("Next").build();
        DocumentMoveRequest request = new DocumentMoveRequest(null, prevSiblingId, nextSiblingId);

        when(documentRepository.findByIdAndDeletedAtIsNull(docId)).thenReturn(Optional.of(doc));
        when(permissionService.requireReadAccess(userId, docId)).thenReturn(doc);
        when(documentRepository.findByIdAndDeletedAtIsNull(prevSiblingId)).thenReturn(Optional.of(prevSibling));
        when(documentRepository.findByIdAndDeletedAtIsNull(nextSiblingId)).thenReturn(Optional.of(nextSibling));
        when(permissionService.resolveAccess(userId, prevSiblingId)).thenReturn(DocumentAccessLevel.VIEW);
        when(permissionService.resolveAccess(userId, nextSiblingId)).thenReturn(DocumentAccessLevel.VIEW);
        when(userDocumentOrderRepository.findOrderKeyByUserIdAndDocumentId(userId, prevSiblingId))
                .thenReturn(Optional.of("a4"));
        when(userDocumentOrderRepository.findOrderKeyByUserIdAndDocumentId(userId, nextSiblingId))
                .thenReturn(Optional.of("a8"));
        // A private-root document lives between the two shared siblings in the single
        // shared user_document_orders key space; the moved doc must slot between the
        // actual adjacent keys instead of colliding with the interleaved document.
        when(userDocumentOrderRepository.findMinOrderKeyGreaterThan(eq(userId), eq("a4"), eq(docId)))
                .thenReturn(Optional.of("a5"));
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(userDocumentOrderRepository.findByUser_IdAndDocument_Id(userId, docId))
                .thenReturn(Optional.empty());
        when(userDocumentOrderRepository.saveAndFlush(any(UserDocumentOrder.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));
        when(documentRepository.existsNonTrashedChildrenByParentId(docId)).thenReturn(false);
        when(permissionService.resolveAccess(userId, docId)).thenReturn(DocumentAccessLevel.VIEW);

        DocumentResponse result = documentTreeService.move(userId, docId, request);

        assertNotNull(result.orderKey());
        assertTrue(result.orderKey().compareTo("a4") > 0);
        assertTrue(result.orderKey().compareTo("a5") < 0);
        verify(userDocumentOrderRepository).saveAndFlush(any(UserDocumentOrder.class));
    }

    @Test
    void move_rootReorderWithInvertedNeighborKeys_placesDocumentBetweenThem() {
        UUID docId = UUID.randomUUID();
        UUID prevSiblingId = UUID.randomUUID();
        UUID nextSiblingId = UUID.randomUUID();
        User owner = User.builder().id(UUID.randomUUID()).build();

        Document doc = Document.builder()
                .id(docId)
                .user(owner)
                .title("Shared Doc")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        Document prevSibling =
                Document.builder().id(prevSiblingId).user(owner).title("Prev").build();
        Document nextSibling =
                Document.builder().id(nextSiblingId).user(owner).title("Next").build();
        DocumentMoveRequest request = new DocumentMoveRequest(null, prevSiblingId, nextSiblingId);

        when(documentRepository.findByIdAndDeletedAtIsNull(docId)).thenReturn(Optional.of(doc));
        when(permissionService.requireReadAccess(userId, docId)).thenReturn(doc);
        when(documentRepository.findByIdAndDeletedAtIsNull(prevSiblingId)).thenReturn(Optional.of(prevSibling));
        when(documentRepository.findByIdAndDeletedAtIsNull(nextSiblingId)).thenReturn(Optional.of(nextSibling));
        when(permissionService.resolveAccess(userId, prevSiblingId)).thenReturn(DocumentAccessLevel.VIEW);
        when(permissionService.resolveAccess(userId, nextSiblingId)).thenReturn(DocumentAccessLevel.VIEW);
        // The frontend can report prev/next in display order, which is inverted
        // relative to the ascending key space (Gothhaa a4zx above EBbbba a4zt).
        when(userDocumentOrderRepository.findOrderKeyByUserIdAndDocumentId(userId, prevSiblingId))
                .thenReturn(Optional.of("a4zx"));
        when(userDocumentOrderRepository.findOrderKeyByUserIdAndDocumentId(userId, nextSiblingId))
                .thenReturn(Optional.of("a4zt"));
        when(userDocumentOrderRepository.findMinOrderKeyGreaterThan(eq(userId), eq("a4zt"), eq(docId)))
                .thenReturn(Optional.of("a4zx"));
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(userDocumentOrderRepository.findByUser_IdAndDocument_Id(userId, docId))
                .thenReturn(Optional.empty());
        when(userDocumentOrderRepository.saveAndFlush(any(UserDocumentOrder.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));
        when(documentRepository.existsNonTrashedChildrenByParentId(docId)).thenReturn(false);
        when(permissionService.resolveAccess(userId, docId)).thenReturn(DocumentAccessLevel.VIEW);

        DocumentResponse result = documentTreeService.move(userId, docId, request);

        assertNotNull(result.orderKey());
        assertTrue(result.orderKey().compareTo("a4zt") > 0);
        assertTrue(result.orderKey().compareTo("a4zx") < 0);
        verify(userDocumentOrderRepository).saveAndFlush(any(UserDocumentOrder.class));
    }

    @Test
    void move_rootReorderFrontOfInterleavedList_placesDocumentBeforeFirstSibling() {
        UUID docId = UUID.randomUUID();
        UUID nextSiblingId = UUID.randomUUID();
        User owner = User.builder().id(UUID.randomUUID()).build();

        Document doc = Document.builder()
                .id(docId)
                .user(owner)
                .title("Shared Doc")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        Document nextSibling =
                Document.builder().id(nextSiblingId).user(owner).title("Next").build();
        DocumentMoveRequest request = new DocumentMoveRequest(null, null, nextSiblingId);

        when(documentRepository.findByIdAndDeletedAtIsNull(docId)).thenReturn(Optional.of(doc));
        when(permissionService.requireReadAccess(userId, docId)).thenReturn(doc);
        when(documentRepository.findByIdAndDeletedAtIsNull(nextSiblingId)).thenReturn(Optional.of(nextSibling));
        when(permissionService.resolveAccess(userId, nextSiblingId)).thenReturn(DocumentAccessLevel.VIEW);
        when(userDocumentOrderRepository.findOrderKeyByUserIdAndDocumentId(userId, nextSiblingId))
                .thenReturn(Optional.of("a8"));
        // A private-root document sits just before the first shared sibling.
        when(userDocumentOrderRepository.findMaxOrderKeyLessThan(eq(userId), eq("a8"), eq(docId)))
                .thenReturn(Optional.of("a4"));
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(userDocumentOrderRepository.findByUser_IdAndDocument_Id(userId, docId))
                .thenReturn(Optional.empty());
        when(userDocumentOrderRepository.saveAndFlush(any(UserDocumentOrder.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));
        when(documentRepository.existsNonTrashedChildrenByParentId(docId)).thenReturn(false);
        when(permissionService.resolveAccess(userId, docId)).thenReturn(DocumentAccessLevel.VIEW);

        DocumentResponse result = documentTreeService.move(userId, docId, request);

        assertNotNull(result.orderKey());
        assertTrue(result.orderKey().compareTo("a4") > 0);
        assertTrue(result.orderKey().compareTo("a8") < 0);
        verify(userDocumentOrderRepository).saveAndFlush(any(UserDocumentOrder.class));
    }

    @Test
    void move_frontReorderCollision_retryLandsInReindexedGapWithoutConflict() {
        UUID docId = UUID.randomUUID();
        UUID siblingId = UUID.randomUUID();
        User owner = User.builder().id(UUID.randomUUID()).build();

        Document doc = Document.builder()
                .id(docId)
                .user(owner)
                .title("Shared Doc")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        Document siblingDoc =
                Document.builder().id(siblingId).user(user).title("Sibling").build();

        UserDocumentOrder siblingOrder = UserDocumentOrder.builder()
                .user(user)
                .document(siblingDoc)
                .orderKey("a0")
                .build();
        UserDocumentOrder otherOrder = UserDocumentOrder.builder()
                .user(user)
                .document(Document.builder().id(UUID.randomUUID()).build())
                .orderKey("Zz")
                .build();

        DocumentMoveRequest request = new DocumentMoveRequest(null, null, siblingId);

        when(documentRepository.findByIdAndDeletedAtIsNull(docId)).thenReturn(Optional.of(doc));
        when(permissionService.requireReadAccess(userId, docId)).thenReturn(doc);
        when(documentRepository.findByIdAndDeletedAtIsNull(siblingId)).thenReturn(Optional.of(siblingDoc));
        when(userDocumentOrderRepository.findOrderKeyByUserIdAndDocumentId(userId, siblingId))
                .thenAnswer(invocation -> Optional.of(siblingOrder.getOrderKey()));
        when(userDocumentOrderRepository.findMaxOrderKeyLessThan(eq(userId), anyString(), eq(docId)))
                .thenReturn(Optional.empty());
        when(userDocumentOrderRepository.findAllForReindex(userId))
                .thenReturn(new java.util.ArrayList<>(List.of(otherOrder, siblingOrder)));
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(userDocumentOrderRepository.findByUser_IdAndDocument_Id(userId, docId))
                .thenReturn(Optional.empty());
        when(userDocumentOrderRepository.saveAndFlush(any(UserDocumentOrder.class)))
                .thenThrow(new DataIntegrityViolationException("order_key unique violation"))
                .thenAnswer(invocation -> invocation.getArgument(0));
        when(documentRepository.existsNonTrashedChildrenByParentId(docId)).thenReturn(false);
        when(permissionService.resolveAccess(userId, docId)).thenReturn(DocumentAccessLevel.VIEW);

        DocumentResponse result = documentTreeService.move(userId, docId, request);

        assertNotNull(result.orderKey());
        assertEquals("a8", siblingOrder.getOrderKey());
        assertTrue(result.orderKey().compareTo("a0") > 0);
        assertTrue(result.orderKey().compareTo("a8") < 0);
        verify(userDocumentOrderRepository, times(2)).saveAndFlush(any(UserDocumentOrder.class));
        verify(userDocumentOrderRepository).findAllForReindex(userId);
    }

    @Test
    void move_collaboratorWithAncestorShareNoDirectRow_reordersSuccessfully() {
        UUID docId = UUID.randomUUID();
        UUID prevSiblingId = UUID.randomUUID();
        User owner = User.builder().id(UUID.randomUUID()).build();

        Document doc = Document.builder()
                .id(docId)
                .user(owner)
                .title("Shared Doc")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        Document prevSibling =
                Document.builder().id(prevSiblingId).user(owner).title("Prev").build();
        DocumentMoveRequest request = new DocumentMoveRequest(null, prevSiblingId, null);

        when(documentRepository.findByIdAndDeletedAtIsNull(docId)).thenReturn(Optional.of(doc));
        when(permissionService.requireReadAccess(userId, docId)).thenReturn(doc);
        when(documentRepository.findByIdAndDeletedAtIsNull(prevSiblingId)).thenReturn(Optional.of(prevSibling));
        when(permissionService.resolveAccess(userId, prevSiblingId)).thenReturn(DocumentAccessLevel.VIEW);
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(userDocumentOrderRepository.findOrderKeyByUserIdAndDocumentId(userId, prevSiblingId))
                .thenReturn(Optional.of("a0"));
        when(userDocumentOrderRepository.findMinOrderKeyGreaterThan(eq(userId), eq("a0"), eq(docId)))
                .thenReturn(Optional.empty());
        when(userDocumentOrderRepository.findByUser_IdAndDocument_Id(userId, docId))
                .thenReturn(Optional.empty());
        when(userDocumentOrderRepository.saveAndFlush(any(UserDocumentOrder.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));
        when(permissionService.resolveAccess(userId, docId)).thenReturn(DocumentAccessLevel.VIEW);

        DocumentResponse result = documentTreeService.move(userId, docId, request);

        assertNotNull(result.orderKey());
        assertTrue(result.orderKey().compareTo("a0") > 0);
        assertEquals(DocumentAccessLevel.VIEW, result.accessLevel());
    }

    @Test
    void move_unauthorizedSiblingReference_throwsNotFound() {
        UUID docId = UUID.randomUUID();
        UUID prevSiblingId = UUID.randomUUID();
        User otherOwner = User.builder().id(UUID.randomUUID()).build();

        Document doc = Document.builder().id(docId).user(user).title("My Doc").build();
        Document secretSibling = Document.builder()
                .id(prevSiblingId)
                .user(otherOwner)
                .title("Secret")
                .build();

        DocumentMoveRequest request = new DocumentMoveRequest(null, prevSiblingId, null);

        when(documentRepository.findByIdAndDeletedAtIsNull(docId)).thenReturn(Optional.of(doc));
        when(permissionService.requireEditAccess(userId, docId)).thenReturn(doc);
        when(documentRepository.findByIdAndDeletedAtIsNull(prevSiblingId)).thenReturn(Optional.of(secretSibling));
        when(permissionService.resolveAccess(userId, prevSiblingId)).thenReturn(null);

        ApiException ex = assertThrows(ApiException.class, () -> documentTreeService.move(userId, docId, request));
        assertEquals(ErrorCode.NOT_FOUND, ex.getErrorCode());
    }

    @Test
    void move_nestedSiblingReferenceForRootMove_throwsValidationFailed() {
        UUID docId = UUID.randomUUID();
        UUID prevSiblingId = UUID.randomUUID();
        Document parent = Document.builder().id(UUID.randomUUID()).user(user).build();

        Document doc = Document.builder().id(docId).user(user).title("My Doc").build();
        Document nestedSibling = Document.builder()
                .id(prevSiblingId)
                .user(user)
                .parent(parent)
                .title("Nested Sibling")
                .build();

        DocumentMoveRequest request = new DocumentMoveRequest(null, prevSiblingId, null);

        when(documentRepository.findByIdAndDeletedAtIsNull(docId)).thenReturn(Optional.of(doc));
        when(permissionService.requireEditAccess(userId, docId)).thenReturn(doc);
        when(documentRepository.findByIdAndDeletedAtIsNull(prevSiblingId)).thenReturn(Optional.of(nestedSibling));

        ApiException ex = assertThrows(ApiException.class, () -> documentTreeService.move(userId, docId, request));
        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
        assertEquals("sibling does not belong to root navigation", ex.getMessage());
    }
}
