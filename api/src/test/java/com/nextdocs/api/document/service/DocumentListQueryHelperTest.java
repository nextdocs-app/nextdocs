package com.nextdocs.api.document.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.config.DocumentProperties;
import com.nextdocs.api.document.dto.response.DocumentResponse;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.repository.AccessGrantRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.repository.SharedDocumentCandidate;
import com.nextdocs.api.document.repository.SharedRootCandidate;
import com.nextdocs.api.document.repository.UserDocumentOrderRepository;
import com.nextdocs.api.space.service.SpaceAccessService;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;

@ExtendWith(MockitoExtension.class)
class DocumentListQueryHelperTest {

    @Mock
    private DocumentRepository documentRepository;

    @Mock
    private AccessGrantRepository accessGrantRepository;

    @Mock
    private UserDocumentOrderRepository userDocumentOrderRepository;

    @Mock
    private DocumentProperties documentProperties;

    @Mock
    private PermissionService permissionService;

    @Mock
    private SpaceAccessService spaceAccessService;

    @InjectMocks
    private DocumentListQueryHelper queryHelper;

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
    }

    @Test
    void list_rootPrivate_returnsPrivateRootsWithComputedFields() {
        Document root1 = Document.builder()
                .id(UUID.randomUUID())
                .user(user)
                .title("Private Root")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        PageRequest pageable = PageRequest.of(0, 50);
        Page<Object[]> queryPage = new PageImpl<>(List.<Object[]>of(new Object[] {root1, "a0"}));

        when(documentRepository.findPrivateRootDocuments(userId, pageable)).thenReturn(queryPage);
        when(documentRepository.countNonTrashedChildrenByParentIds(any()))
                .thenReturn(List.<Object[]>of(new Object[] {root1.getId(), 2L}));

        Page<DocumentResponse> result = queryHelper.list(userId, "root", "private", null, null, pageable);

        assertEquals(1, result.getContent().size());
        DocumentResponse item = result.getContent().get(0);
        assertEquals("Private Root", item.title());
        assertEquals("a0", item.orderKey());
        assertTrue(item.hasChildren());
        assertFalse(item.hasCollaborators());
        assertEquals(DocumentAccessLevel.OWNER, item.accessLevel());
    }

    @Test
    void list_rootShared_returnsSharedRootsWithBatchPermissions() {
        User otherOwner = User.builder().id(UUID.randomUUID()).build();
        Document sharedWithMe = Document.builder()
                .id(UUID.randomUUID())
                .user(otherOwner)
                .title("Shared with me")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        Document ownerShared = Document.builder()
                .id(UUID.randomUUID())
                .user(user)
                .title("Shared by me")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        PageRequest pageable = PageRequest.of(0, 50);
        List<SharedRootCandidate> candidates = List.of(
                new SharedRootCandidate(
                        sharedWithMe.getId(),
                        otherOwner.getId(),
                        "Shared with me",
                        sharedWithMe.getCreatedAt(),
                        sharedWithMe.getUpdatedAt(),
                        "a0"),
                new SharedRootCandidate(
                        ownerShared.getId(),
                        user.getId(),
                        "Shared by me",
                        ownerShared.getCreatedAt(),
                        ownerShared.getUpdatedAt(),
                        "a1"));

        when(documentRepository.findSharedRootDocuments(userId)).thenReturn(candidates);
        when(documentRepository.findAllById(any())).thenReturn(List.of(sharedWithMe, ownerShared));
        when(documentRepository.countNonTrashedChildrenByParentIds(any())).thenReturn(List.of());
        when(accessGrantRepository.findDocumentIdsWithPositiveGrants(any())).thenReturn(List.of(ownerShared.getId()));
        when(permissionService.resolveAccessBatch(eq(userId), any()))
                .thenReturn(java.util.Map.of(sharedWithMe.getId(), DocumentAccessLevel.EDIT));

        Page<DocumentResponse> result = queryHelper.list(userId, "root", "shared", null, null, pageable);

        assertEquals(2, result.getContent().size());
        DocumentResponse doc1 = result.getContent().get(0);
        assertEquals("Shared with me", doc1.title());
        assertEquals("a0", doc1.orderKey());
        assertFalse(doc1.hasCollaborators());
        assertEquals(DocumentAccessLevel.EDIT, doc1.accessLevel());

        DocumentResponse doc2 = result.getContent().get(1);
        assertEquals("Shared by me", doc2.title());
        assertEquals("a1", doc2.orderKey());
        assertTrue(doc2.hasCollaborators());
        assertEquals(DocumentAccessLevel.OWNER, doc2.accessLevel());
    }

    @Test
    void list_flatShared_returnsUserDocumentOrderForNestedFloatedSharedDocuments() {
        User otherOwner = User.builder().id(UUID.randomUUID()).build();
        UUID privateParentId = UUID.randomUUID();
        Document privateParent = Document.builder()
                .id(privateParentId)
                .user(otherOwner)
                .title("Private Parent")
                .build();

        Document floatedChild = Document.builder()
                .id(UUID.randomUUID())
                .user(otherOwner)
                .title("Floated Child")
                .parent(privateParent)
                .siblingOrderKey("sibling-0")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        PageRequest pageable = PageRequest.of(0, 20);
        when(documentRepository.findSharedWithUserId(userId))
                .thenReturn(List.of(new SharedDocumentCandidate(
                        floatedChild.getId(),
                        privateParentId,
                        "sibling-0",
                        "Floated Child",
                        floatedChild.getCreatedAt(),
                        floatedChild.getUpdatedAt())));
        when(documentRepository.findAllById(any())).thenReturn(List.of(floatedChild));
        when(documentRepository.countNonTrashedChildrenByParentIds(any())).thenReturn(List.of());
        when(accessGrantRepository.findDocumentIdsWithPositiveGrants(any())).thenReturn(List.of());
        // Parent is inaccessible: the batch resolves nothing for it, so the child floats.
        when(permissionService.resolveAccessBatch(eq(userId), any()))
                .thenReturn(java.util.Map.of(floatedChild.getId(), DocumentAccessLevel.VIEW));
        when(userDocumentOrderRepository.findOrderKeysByUserIdAndDocumentIds(eq(userId), any()))
                .thenReturn(List.<Object[]>of(new Object[] {floatedChild.getId(), "user-order-1"}));

        Page<DocumentResponse> result = queryHelper.list(userId, null, "shared", null, null, pageable);

        assertEquals(1, result.getContent().size());
        DocumentResponse doc = result.getContent().get(0);
        assertEquals("Floated Child", doc.title());
        assertEquals(privateParentId, doc.parentId());
        // Should return the user's personal UserDocumentOrder key, not the owner's siblingOrderKey
        assertEquals("user-order-1", doc.orderKey());
        assertEquals(DocumentAccessLevel.VIEW, doc.accessLevel());
    }

    @Test
    void list_flatShared_returnsNullOrderKeyForFloatedDocumentWithoutUserDocumentOrder() {
        User otherOwner = User.builder().id(UUID.randomUUID()).build();
        UUID privateParentId = UUID.randomUUID();
        Document privateParent = Document.builder()
                .id(privateParentId)
                .user(otherOwner)
                .title("Private Parent")
                .build();

        Document floatedChild = Document.builder()
                .id(UUID.randomUUID())
                .user(otherOwner)
                .title("Floated Child")
                .parent(privateParent)
                .siblingOrderKey("sibling-0")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        PageRequest pageable = PageRequest.of(0, 20);
        when(documentRepository.findSharedWithUserId(userId))
                .thenReturn(List.of(new SharedDocumentCandidate(
                        floatedChild.getId(),
                        privateParentId,
                        "sibling-0",
                        "Floated Child",
                        floatedChild.getCreatedAt(),
                        floatedChild.getUpdatedAt())));
        when(documentRepository.findAllById(any())).thenReturn(List.of(floatedChild));
        when(documentRepository.countNonTrashedChildrenByParentIds(any())).thenReturn(List.of());
        when(accessGrantRepository.findDocumentIdsWithPositiveGrants(any())).thenReturn(List.of());
        // Parent is inaccessible: the batch resolves nothing for it, so the child floats.
        when(permissionService.resolveAccessBatch(eq(userId), any()))
                .thenReturn(java.util.Map.of(floatedChild.getId(), DocumentAccessLevel.VIEW));
        when(userDocumentOrderRepository.findOrderKeysByUserIdAndDocumentIds(eq(userId), any()))
                .thenReturn(List.of());

        Page<DocumentResponse> result = queryHelper.list(userId, null, "shared", null, null, pageable);

        assertEquals(1, result.getContent().size());
        DocumentResponse doc = result.getContent().get(0);
        assertEquals("Floated Child", doc.title());
        assertEquals(privateParentId, doc.parentId());
        // Should return null (not the owner's siblingOrderKey) when no personal UserDocumentOrder exists
        assertNull(doc.orderKey());
        assertEquals(DocumentAccessLevel.VIEW, doc.accessLevel());
    }

    @Test
    void list_flatShared_returnsSiblingOrderKeyForChildOfAccessibleSharedParent() {
        User otherOwner = User.builder().id(UUID.randomUUID()).build();
        UUID sharedParentId = UUID.randomUUID();
        Document sharedParent = Document.builder()
                .id(sharedParentId)
                .user(otherOwner)
                .title("Shared Parent")
                .build();

        Document sharedChild = Document.builder()
                .id(UUID.randomUUID())
                .user(otherOwner)
                .title("Shared Child")
                .parent(sharedParent)
                .siblingOrderKey("sibling-0")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        PageRequest pageable = PageRequest.of(0, 20);
        when(documentRepository.findSharedWithUserId(userId))
                .thenReturn(List.of(new SharedDocumentCandidate(
                        sharedChild.getId(),
                        sharedParentId,
                        "sibling-0",
                        "Shared Child",
                        sharedChild.getCreatedAt(),
                        sharedChild.getUpdatedAt())));
        when(documentRepository.findAllById(any())).thenReturn(List.of(sharedChild));
        when(documentRepository.countNonTrashedChildrenByParentIds(any())).thenReturn(List.of());
        when(accessGrantRepository.findDocumentIdsWithPositiveGrants(any())).thenReturn(List.of());
        // Parent IS accessible, so the child keeps its owner's sibling order key.
        when(permissionService.resolveAccessBatch(eq(userId), any()))
                .thenReturn(java.util.Map.of(
                        sharedChild.getId(), DocumentAccessLevel.VIEW, sharedParentId, DocumentAccessLevel.VIEW));

        Page<DocumentResponse> result = queryHelper.list(userId, null, "shared", null, null, pageable);

        assertEquals(1, result.getContent().size());
        DocumentResponse doc = result.getContent().get(0);
        assertEquals("Shared Child", doc.title());
        assertEquals(sharedParentId, doc.parentId());
        // Should keep siblingOrderKey since its parent is accessible/shared
        assertEquals("sibling-0", doc.orderKey());
    }

    @Test
    void list_emptyPagePreservesTotalElements() {
        PageRequest pageable = PageRequest.of(2, 10);
        Page<Object[]> emptyPageWithTotals = new PageImpl<>(List.of(), pageable, 25);

        when(documentRepository.findPrivateRootDocuments(userId, pageable)).thenReturn(emptyPageWithTotals);

        Page<DocumentResponse> result = queryHelper.list(userId, "root", "private", null, null, pageable);

        assertTrue(result.getContent().isEmpty());
        assertEquals(25, result.getTotalElements());
        assertEquals(3, result.getTotalPages());
    }

    @Test
    void list_children_returnsOrderedChildDocuments() {
        UUID parentId = UUID.randomUUID();
        Document child1 = Document.builder()
                .id(UUID.randomUUID())
                .user(user)
                .title("Child 1")
                .siblingOrderKey("a0")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        PageRequest pageable = PageRequest.of(0, 50);
        Page<Document> childPage = new PageImpl<>(List.of(child1));

        when(documentRepository.findChildIdsByParent_IdAndDeletedAtIsNull(parentId))
                .thenReturn(List.of(child1.getId()));
        when(documentRepository.findAllByIdInAndParent_IdAndDeletedAtIsNull(
                        eq(List.of(child1.getId())), eq(parentId), any(Pageable.class)))
                .thenReturn(childPage);
        when(documentRepository.countNonTrashedChildrenByParentIds(any())).thenReturn(List.of());
        when(accessGrantRepository.findDocumentIdsWithPositiveGrants(any())).thenReturn(List.of());
        when(permissionService.resolveAccessBatch(eq(userId), any()))
                .thenReturn(java.util.Map.of(child1.getId(), DocumentAccessLevel.OWNER));

        Page<DocumentResponse> result = queryHelper.list(userId, parentId.toString(), "all", null, null, pageable);

        assertEquals(1, result.getContent().size());
        DocumentResponse item = result.getContent().get(0);
        assertEquals("Child 1", item.title());
        assertEquals(parentId, item.parentId());
        assertEquals("a0", item.orderKey());
        assertFalse(item.hasChildren());
        assertFalse(item.hasCollaborators());
        assertEquals(DocumentAccessLevel.OWNER, item.accessLevel());
    }

    @Test
    void list_children_ownerChildInAnArchivedSpace_reportsView() {
        UUID parentId = UUID.randomUUID();
        Document child = Document.builder()
                .id(UUID.randomUUID())
                .user(user)
                .title("Frozen Child")
                .siblingOrderKey("a0")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        PageRequest pageable = PageRequest.of(0, 50);
        when(permissionService.requireReadAccess(userId, parentId)).thenReturn(child);
        when(documentRepository.findChildIdsByParent_IdAndDeletedAtIsNull(parentId))
                .thenReturn(List.of(child.getId()));
        when(documentRepository.findAllByIdInAndParent_IdAndDeletedAtIsNull(
                        eq(List.of(child.getId())), eq(parentId), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(child)));
        when(documentRepository.countNonTrashedChildrenByParentIds(any())).thenReturn(List.of());
        when(accessGrantRepository.findDocumentIdsWithPositiveGrants(any())).thenReturn(List.of());
        when(permissionService.resolveAccessBatch(eq(userId), any()))
                .thenReturn(java.util.Map.of(child.getId(), DocumentAccessLevel.VIEW));

        Page<DocumentResponse> result = queryHelper.list(userId, parentId.toString(), "all", null, null, pageable);

        assertEquals(DocumentAccessLevel.VIEW, result.getContent().get(0).accessLevel());
    }

    @Test
    void list_children_hidesPagesWithoutReadAccess() {
        UUID parentId = UUID.randomUUID();
        Document visible = Document.builder()
                .id(UUID.randomUUID())
                .user(user)
                .title("Visible")
                .siblingOrderKey("a0")
                .build();
        Document denied = Document.builder()
                .id(UUID.randomUUID())
                .user(user)
                .title("Denied")
                .siblingOrderKey("a1")
                .build();
        PageRequest pageable = PageRequest.of(0, 50);

        when(documentRepository.findChildIdsByParent_IdAndDeletedAtIsNull(parentId))
                .thenReturn(List.of(visible.getId(), denied.getId()));
        when(permissionService.resolveAccessBatch(eq(userId), any()))
                .thenReturn(java.util.Map.of(visible.getId(), DocumentAccessLevel.VIEW));
        when(documentRepository.findAllByIdInAndParent_IdAndDeletedAtIsNull(
                        eq(List.of(visible.getId())), eq(parentId), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(visible)));
        when(documentRepository.countNonTrashedChildrenByParentIds(any())).thenReturn(List.of());
        when(accessGrantRepository.findDocumentIdsWithPositiveGrants(any())).thenReturn(List.of());

        Page<DocumentResponse> result = queryHelper.list(userId, parentId.toString(), "all", null, null, pageable);

        assertEquals(
                List.of(visible.getId()),
                result.getContent().stream().map(DocumentResponse::id).toList());
        assertEquals(1, result.getTotalElements());
        verify(documentRepository)
                .findAllByIdInAndParent_IdAndDeletedAtIsNull(
                        eq(List.of(visible.getId())), eq(parentId), any(Pageable.class));
    }

    @Test
    void list_flatAll_ownerPageInAnArchivedSpace_reportsView() {
        Document page = Document.builder()
                .id(UUID.randomUUID())
                .user(user)
                .title("Frozen Root")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        PageRequest pageable = PageRequest.of(0, 20);
        when(documentRepository.findAllByUser_IdAndDeletedAtIsNull(eq(userId), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(page)));
        when(documentRepository.countNonTrashedChildrenByParentIds(any())).thenReturn(List.of());
        when(accessGrantRepository.findDocumentIdsWithPositiveGrants(any())).thenReturn(List.of());
        when(permissionService.resolveAccessBatch(eq(userId), any()))
                .thenReturn(java.util.Map.of(page.getId(), DocumentAccessLevel.VIEW));

        Page<DocumentResponse> result = queryHelper.list(userId, null, "all", null, null, pageable);

        assertEquals(1, result.getContent().size());
        assertEquals(DocumentAccessLevel.VIEW, result.getContent().get(0).accessLevel());
    }

    @Test
    void list_unknownScope_throwsValidationFailed() {
        ApiException ex = assertThrows(
                ApiException.class, () -> queryHelper.list(userId, null, "privat", null, null, PageRequest.of(0, 20)));
        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
        assertTrue(ex.getMessage().contains("Invalid scope value"));
    }

    @Test
    void list_flatPrivateScope_throwsValidationFailed() {
        ApiException ex = assertThrows(
                ApiException.class, () -> queryHelper.list(userId, null, "private", null, null, PageRequest.of(0, 20)));
        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
        assertTrue(ex.getMessage().contains("scope=private is only supported for root documents"));
    }

    @Test
    void list_sharedScope_filtersDeniedCandidatesAndComputesExactStableTotal() {
        User otherOwner = User.builder().id(UUID.randomUUID()).build();
        Document allowedDoc1 = Document.builder()
                .id(UUID.randomUUID())
                .user(otherOwner)
                .title("Allowed 1")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();
        Document deniedDoc = Document.builder()
                .id(UUID.randomUUID())
                .user(otherOwner)
                .title("Denied")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();
        Document allowedDoc2 = Document.builder()
                .id(UUID.randomUUID())
                .user(otherOwner)
                .title("Allowed 2")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        List<SharedRootCandidate> candidates = List.of(
                new SharedRootCandidate(
                        allowedDoc1.getId(),
                        otherOwner.getId(),
                        "Allowed 1",
                        allowedDoc1.getCreatedAt(),
                        allowedDoc1.getUpdatedAt(),
                        "a0"),
                new SharedRootCandidate(
                        deniedDoc.getId(),
                        otherOwner.getId(),
                        "Denied",
                        deniedDoc.getCreatedAt(),
                        deniedDoc.getUpdatedAt(),
                        "a1"),
                new SharedRootCandidate(
                        allowedDoc2.getId(),
                        otherOwner.getId(),
                        "Allowed 2",
                        allowedDoc2.getCreatedAt(),
                        allowedDoc2.getUpdatedAt(),
                        "a2"));

        when(documentRepository.findSharedRootDocuments(userId)).thenReturn(candidates);
        when(documentRepository.findAllById(any())).thenReturn(List.of(allowedDoc1, deniedDoc, allowedDoc2));
        when(documentRepository.countNonTrashedChildrenByParentIds(any())).thenReturn(List.of());
        when(accessGrantRepository.findDocumentIdsWithPositiveGrants(any())).thenReturn(List.of());
        when(permissionService.resolveAccessBatch(eq(userId), any()))
                .thenReturn(java.util.Map.of(
                        allowedDoc1.getId(), DocumentAccessLevel.VIEW,
                        allowedDoc2.getId(), DocumentAccessLevel.EDIT));

        Page<DocumentResponse> page0 = queryHelper.list(userId, "root", "shared", null, null, PageRequest.of(0, 1));
        assertEquals(1, page0.getContent().size());
        assertEquals("Allowed 1", page0.getContent().get(0).title());
        assertEquals(2, page0.getTotalElements());
        // The denied candidate must never reach the entity loader on either page.
        verify(documentRepository).findAllById(List.of(allowedDoc1.getId()));

        Page<DocumentResponse> page1 = queryHelper.list(userId, "root", "shared", null, null, PageRequest.of(1, 1));
        assertEquals(1, page1.getContent().size());
        assertEquals("Allowed 2", page1.getContent().get(0).title());
        assertEquals(2, page1.getTotalElements());
        verify(documentRepository).findAllById(List.of(allowedDoc2.getId()));
    }

    @Test
    void list_sharedScope_appliesSortOrderToFilteredCandidates() {
        User otherOwner = User.builder().id(UUID.randomUUID()).build();
        Document docB = Document.builder()
                .id(UUID.randomUUID())
                .user(otherOwner)
                .title("Bravo")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();
        Document docA = Document.builder()
                .id(UUID.randomUUID())
                .user(otherOwner)
                .title("Alpha")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        List<SharedRootCandidate> candidates = List.of(
                new SharedRootCandidate(
                        docB.getId(), otherOwner.getId(), "Bravo", docB.getCreatedAt(), docB.getUpdatedAt(), "b0"),
                new SharedRootCandidate(
                        docA.getId(), otherOwner.getId(), "Alpha", docA.getCreatedAt(), docA.getUpdatedAt(), "a0"));

        when(documentRepository.findSharedRootDocuments(userId)).thenReturn(candidates);
        when(documentRepository.findAllById(any())).thenReturn(List.of(docB, docA));
        when(documentRepository.countNonTrashedChildrenByParentIds(any())).thenReturn(List.of());
        when(accessGrantRepository.findDocumentIdsWithPositiveGrants(any())).thenReturn(List.of());
        when(permissionService.resolveAccessBatch(eq(userId), any()))
                .thenReturn(java.util.Map.of(
                        docB.getId(), DocumentAccessLevel.VIEW,
                        docA.getId(), DocumentAccessLevel.VIEW));

        Page<DocumentResponse> result = queryHelper.list(
                userId, "root", "shared", null, null, PageRequest.of(0, 10, Sort.by(Sort.Order.asc("title"))));

        assertEquals(2, result.getContent().size());
        assertEquals("Alpha", result.getContent().get(0).title());
        assertEquals("Bravo", result.getContent().get(1).title());
    }

    @Test
    void list_flatShared_appliesSortOrderToFilteredCandidates() {
        User otherOwner = User.builder().id(UUID.randomUUID()).build();
        Document docB = Document.builder()
                .id(UUID.randomUUID())
                .user(otherOwner)
                .title("Bravo")
                .createdAt(OffsetDateTime.now().minusDays(1))
                .updatedAt(OffsetDateTime.now())
                .build();
        Document docA = Document.builder()
                .id(UUID.randomUUID())
                .user(otherOwner)
                .title("Alpha")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        when(documentRepository.findSharedWithUserId(userId))
                .thenReturn(List.of(
                        new SharedDocumentCandidate(
                                docB.getId(), null, null, "Bravo", docB.getCreatedAt(), docB.getUpdatedAt()),
                        new SharedDocumentCandidate(
                                docA.getId(), null, null, "Alpha", docA.getCreatedAt(), docA.getUpdatedAt())));
        when(documentRepository.findAllById(any())).thenReturn(List.of(docB, docA));
        when(documentRepository.countNonTrashedChildrenByParentIds(any())).thenReturn(List.of());
        when(accessGrantRepository.findDocumentIdsWithPositiveGrants(any())).thenReturn(List.of());
        when(permissionService.resolveAccessBatch(eq(userId), any()))
                .thenReturn(java.util.Map.of(
                        docB.getId(), DocumentAccessLevel.VIEW,
                        docA.getId(), DocumentAccessLevel.VIEW));

        Page<DocumentResponse> result = queryHelper.list(
                userId, null, "shared", null, null, PageRequest.of(0, 10, Sort.by(Sort.Order.asc("title"))));

        assertEquals(2, result.getContent().size());
        assertEquals("Alpha", result.getContent().get(0).title());
        assertEquals("Bravo", result.getContent().get(1).title());
    }

    @Test
    void list_flatShared_loadsOnlyTheRequestedPageOfEntities() {
        User otherOwner = User.builder().id(UUID.randomUUID()).build();
        Document newest = Document.builder()
                .id(UUID.randomUUID())
                .user(otherOwner)
                .title("Newest")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();
        Document older = Document.builder()
                .id(UUID.randomUUID())
                .user(otherOwner)
                .title("Older")
                .createdAt(OffsetDateTime.now().minusDays(1))
                .updatedAt(OffsetDateTime.now().minusDays(1))
                .build();

        when(documentRepository.findSharedWithUserId(userId))
                .thenReturn(List.of(
                        new SharedDocumentCandidate(
                                newest.getId(), null, null, "Newest", newest.getCreatedAt(), newest.getUpdatedAt()),
                        new SharedDocumentCandidate(
                                older.getId(), null, null, "Older", older.getCreatedAt(), older.getUpdatedAt())));
        when(permissionService.resolveAccessBatch(eq(userId), any()))
                .thenReturn(java.util.Map.of(
                        newest.getId(), DocumentAccessLevel.VIEW, older.getId(), DocumentAccessLevel.VIEW));
        when(userDocumentOrderRepository.findOrderKeysByUserIdAndDocumentIds(eq(userId), any()))
                .thenReturn(List.of());
        when(documentRepository.findAllById(any())).thenReturn(List.of(newest, older));
        when(documentRepository.countNonTrashedChildrenByParentIds(any())).thenReturn(List.of());
        when(accessGrantRepository.findDocumentIdsWithPositiveGrants(any())).thenReturn(List.of());

        Page<DocumentResponse> result = queryHelper.list(userId, null, "shared", null, null, PageRequest.of(0, 1));

        assertEquals(1, result.getContent().size());
        assertEquals("Newest", result.getContent().get(0).title());
        assertEquals(2, result.getTotalElements());
        // The second candidate must not reach the entity loader on the first page.
        verify(documentRepository).findAllById(List.of(newest.getId()));
    }

    @Test
    void list_sharedScope_allCandidatesDenied_returnsEmptyPage() {
        User otherOwner = User.builder().id(UUID.randomUUID()).build();
        Document deniedDoc = Document.builder()
                .id(UUID.randomUUID())
                .user(otherOwner)
                .title("Denied")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        List<SharedRootCandidate> candidates = List.of(new SharedRootCandidate(
                deniedDoc.getId(),
                otherOwner.getId(),
                "Denied",
                deniedDoc.getCreatedAt(),
                deniedDoc.getUpdatedAt(),
                "a0"));

        when(documentRepository.findSharedRootDocuments(userId)).thenReturn(candidates);
        when(permissionService.resolveAccessBatch(eq(userId), any())).thenReturn(java.util.Map.of());

        Page<DocumentResponse> result = queryHelper.list(userId, "root", "shared", null, null, PageRequest.of(0, 20));

        assertTrue(result.isEmpty());
        assertEquals(0, result.getTotalElements());
        verify(documentRepository, never()).countNonTrashedChildrenByParentIds(any());
        verify(documentRepository, never()).findAllById(any());
    }

    @Test
    void list_children_allChildrenDenied_returnsEmptyPage() {
        UUID parentId = UUID.randomUUID();
        UUID childId = UUID.randomUUID();
        PageRequest pageable = PageRequest.of(0, 50);

        when(documentRepository.findChildIdsByParent_IdAndDeletedAtIsNull(parentId))
                .thenReturn(List.of(childId));
        when(permissionService.resolveAccessBatch(eq(userId), eq(List.of(childId))))
                .thenReturn(java.util.Map.of());

        Page<DocumentResponse> result = queryHelper.list(userId, parentId.toString(), "all", null, null, pageable);

        assertTrue(result.isEmpty());
        assertEquals(0, result.getTotalElements());
        verify(documentRepository, never()).findAllByIdInAndParent_IdAndDeletedAtIsNull(any(), any(), any());
    }

    @Test
    void list_childrenWithInvalidScope_throwsValidationFailed() {
        UUID parentId = UUID.randomUUID();
        assertThrows(
                ApiException.class,
                () -> queryHelper.list(userId, parentId.toString(), "shared", null, null, PageRequest.of(0, 20)));
    }

    @Test
    void list_childrenWithInvalidParentIdFormat_throwsValidationFailed() {
        assertThrows(
                ApiException.class,
                () -> queryHelper.list(userId, "invalid-uuid", "all", null, null, PageRequest.of(0, 20)));
    }

    @Test
    void list_trashed_returnsAccessibleTrashedDocuments() {
        Document trashedDoc = Document.builder()
                .id(UUID.randomUUID())
                .user(user)
                .title("Trashed Doc")
                .deletedAt(OffsetDateTime.now().minusDays(2))
                .createdAt(OffsetDateTime.now().minusDays(10))
                .updatedAt(OffsetDateTime.now().minusDays(2))
                .build();

        PageRequest pageable = PageRequest.of(0, 20);
        when(documentProperties.getTrashRetentionDays()).thenReturn(30);
        when(documentRepository.findAccessibleTrashedDocuments(eq(userId), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(trashedDoc)));
        when(accessGrantRepository.findDocumentIdsWithPositiveGrants(any())).thenReturn(List.of());
        when(permissionService.resolveTrashAccessBatch(eq(userId), any()))
                .thenReturn(java.util.Map.of(trashedDoc.getId(), DocumentAccessLevel.OWNER));

        Page<DocumentResponse> result = queryHelper.list(userId, null, null, true, null, pageable);

        assertEquals(1, result.getContent().size());
        DocumentResponse item = result.getContent().get(0);
        assertEquals("Trashed Doc", item.title());
        assertNotNull(item.deletedAt());
        assertNotNull(item.purgeAt());
        assertEquals(DocumentAccessLevel.OWNER, item.accessLevel());
    }

    // --- scope=space ---

    private com.nextdocs.api.space.entity.Space spaceWith(UUID spaceId) {
        return com.nextdocs.api.space.entity.Space.builder()
                .id(spaceId)
                .name("Engineering")
                .build();
    }

    @Test
    void list_spaceScope_returnsTheSpacesRootPages() {
        UUID spaceId = UUID.randomUUID();
        Document page = Document.builder()
                .id(UUID.randomUUID())
                .user(user)
                .title("Space Page")
                .space(spaceWith(spaceId))
                .siblingOrderKey("a1")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        PageRequest pageable = PageRequest.of(0, 50);
        when(spaceAccessService.requireContentRead(userId, spaceId))
                .thenReturn(new com.nextdocs.api.space.service.SpaceAccessService.SpaceContext(
                        spaceWith(spaceId),
                        com.nextdocs.api.workspace.entity.WorkspaceRole.MEMBER,
                        DocumentAccessLevel.OWNER));
        when(documentRepository.findSpaceRootDocuments(userId, spaceId, pageable))
                .thenReturn(new PageImpl<>(List.of(page), pageable, 1));
        when(documentRepository.countNonTrashedChildrenByParentIds(any())).thenReturn(List.of());
        when(accessGrantRepository.findDocumentIdsWithPositiveGrants(any())).thenReturn(List.of());
        when(permissionService.resolveAccessBatch(eq(userId), any()))
                .thenReturn(java.util.Map.of(page.getId(), DocumentAccessLevel.OWNER));

        Page<DocumentResponse> result = queryHelper.list(userId, "root", "space", null, spaceId.toString(), pageable);

        assertEquals(1, result.getContent().size());
        DocumentResponse item = result.getContent().get(0);
        assertEquals("Space Page", item.title());
        assertEquals("a1", item.orderKey());
        assertEquals(spaceId, item.spaceId());
        assertEquals(DocumentAccessLevel.OWNER, item.accessLevel());
        verify(userDocumentOrderRepository, never()).findOrderKeysByUserIdAndDocumentIds(any(), any());
    }

    @Test
    void list_spaceScope_ownerPageInAnArchivedSpace_reportsView() {
        UUID spaceId = UUID.randomUUID();
        Document page = Document.builder()
                .id(UUID.randomUUID())
                .user(user)
                .title("Frozen Page")
                .space(spaceWith(spaceId))
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        PageRequest pageable = PageRequest.of(0, 50);
        when(spaceAccessService.requireContentRead(userId, spaceId))
                .thenReturn(new com.nextdocs.api.space.service.SpaceAccessService.SpaceContext(
                        spaceWith(spaceId),
                        com.nextdocs.api.workspace.entity.WorkspaceRole.MEMBER,
                        DocumentAccessLevel.VIEW));
        when(documentRepository.findSpaceRootDocuments(userId, spaceId, pageable))
                .thenReturn(new PageImpl<>(List.of(page), pageable, 1));
        when(documentRepository.countNonTrashedChildrenByParentIds(any())).thenReturn(List.of());
        when(accessGrantRepository.findDocumentIdsWithPositiveGrants(any())).thenReturn(List.of());
        when(permissionService.resolveAccessBatch(eq(userId), any()))
                .thenReturn(java.util.Map.of(page.getId(), DocumentAccessLevel.VIEW));

        Page<DocumentResponse> result = queryHelper.list(userId, "root", "space", null, spaceId.toString(), pageable);

        assertEquals(DocumentAccessLevel.VIEW, result.getContent().get(0).accessLevel());
    }

    @Test
    void list_spaceScopeWithoutASpaceId_throwsValidationFailed() {
        assertThrows(
                ApiException.class, () -> queryHelper.list(userId, "root", "space", null, null, PageRequest.of(0, 20)));
        assertThrows(
                ApiException.class, () -> queryHelper.list(userId, "root", "space", null, "  ", PageRequest.of(0, 20)));
    }

    @Test
    void list_spaceIdWithAnotherScope_throwsValidationFailed() {
        assertThrows(
                ApiException.class,
                () -> queryHelper.list(
                        userId, null, "all", null, UUID.randomUUID().toString(), PageRequest.of(0, 20)));
    }

    @Test
    void list_spaceScopeWithTrashed_throwsValidationFailed() {
        assertThrows(
                ApiException.class,
                () -> queryHelper.list(
                        userId, null, "space", true, UUID.randomUUID().toString(), PageRequest.of(0, 20)));
    }

    @Test
    void list_spaceScopeWithParentId_throwsValidationFailed() {
        assertThrows(
                ApiException.class,
                () -> queryHelper.list(
                        userId,
                        UUID.randomUUID().toString(),
                        "space",
                        null,
                        UUID.randomUUID().toString(),
                        PageRequest.of(0, 20)));
    }

    @Test
    void list_spaceScopeWithAMalformedSpaceId_throwsValidationFailed() {
        assertThrows(
                ApiException.class,
                () -> queryHelper.list(userId, "root", "space", null, "not-a-uuid", PageRequest.of(0, 20)));
    }
}
