package com.nextdocs.api.document.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.document.config.DocumentProperties;
import com.nextdocs.api.document.dto.response.DocumentResponse;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.repository.DocumentCollaboratorRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.repository.UserDocumentOrderRepository;
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

@ExtendWith(MockitoExtension.class)
class DocumentListQueryHelperTest {

    @Mock
    private DocumentRepository documentRepository;

    @Mock
    private DocumentCollaboratorRepository collaboratorRepository;

    @Mock
    private UserDocumentOrderRepository userDocumentOrderRepository;

    @Mock
    private DocumentProperties documentProperties;

    @Mock
    private PermissionService permissionService;

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

        Page<DocumentResponse> result = queryHelper.list(userId, "root", "private", null, pageable);

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
        Page<Object[]> queryPage =
                new PageImpl<>(List.<Object[]>of(new Object[] {sharedWithMe, "a0"}, new Object[] {ownerShared, "a1"}));

        when(documentRepository.findSharedRootDocuments(userId, pageable)).thenReturn(queryPage);
        when(documentRepository.countNonTrashedChildrenByParentIds(any())).thenReturn(List.of());
        when(collaboratorRepository.findDocumentIdsWithCollaborators(any())).thenReturn(List.of(ownerShared.getId()));
        when(documentRepository.resolveEffectiveAccessBatch(eq(userId), anyString()))
                .thenReturn(List.<Object[]>of(new Object[] {sharedWithMe.getId(), "EDIT"}));

        Page<DocumentResponse> result = queryHelper.list(userId, "root", "shared", null, pageable);

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
        when(documentRepository.findSharedWithUserId(eq(userId), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(floatedChild)));
        when(documentRepository.countNonTrashedChildrenByParentIds(any())).thenReturn(List.of());
        when(collaboratorRepository.findDocumentIdsWithCollaborators(any())).thenReturn(List.of());
        // Parent is inaccessible (not returned in resolveEffectiveAccessBatch for parentIds)
        when(documentRepository.resolveEffectiveAccessBatch(
                        eq(userId), eq(floatedChild.getId().toString())))
                .thenReturn(List.<Object[]>of(new Object[] {floatedChild.getId(), "VIEW"}));
        when(documentRepository.resolveEffectiveAccessBatch(eq(userId), eq(privateParentId.toString())))
                .thenReturn(List.of());
        when(userDocumentOrderRepository.findOrderKeysByUserIdAndDocumentIds(eq(userId), any()))
                .thenReturn(List.<Object[]>of(new Object[] {floatedChild.getId(), "user-order-1"}));

        Page<DocumentResponse> result = queryHelper.list(userId, null, "shared", null, pageable);

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
        when(documentRepository.findSharedWithUserId(eq(userId), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(floatedChild)));
        when(documentRepository.countNonTrashedChildrenByParentIds(any())).thenReturn(List.of());
        when(collaboratorRepository.findDocumentIdsWithCollaborators(any())).thenReturn(List.of());
        // Parent is inaccessible (not returned in resolveEffectiveAccessBatch for parentIds)
        when(documentRepository.resolveEffectiveAccessBatch(
                        eq(userId), eq(floatedChild.getId().toString())))
                .thenReturn(List.<Object[]>of(new Object[] {floatedChild.getId(), "VIEW"}));
        when(documentRepository.resolveEffectiveAccessBatch(eq(userId), eq(privateParentId.toString())))
                .thenReturn(List.of());
        when(userDocumentOrderRepository.findOrderKeysByUserIdAndDocumentIds(eq(userId), any()))
                .thenReturn(List.of());

        Page<DocumentResponse> result = queryHelper.list(userId, null, "shared", null, pageable);

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
        when(documentRepository.findSharedWithUserId(eq(userId), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(sharedChild)));
        when(documentRepository.countNonTrashedChildrenByParentIds(any())).thenReturn(List.of());
        when(collaboratorRepository.findDocumentIdsWithCollaborators(any())).thenReturn(List.of());
        // Parent IS accessible
        when(documentRepository.resolveEffectiveAccessBatch(
                        eq(userId), eq(sharedChild.getId().toString())))
                .thenReturn(List.<Object[]>of(new Object[] {sharedChild.getId(), "VIEW"}));
        when(documentRepository.resolveEffectiveAccessBatch(eq(userId), eq(sharedParentId.toString())))
                .thenReturn(List.<Object[]>of(new Object[] {sharedParentId, "VIEW"}));

        Page<DocumentResponse> result = queryHelper.list(userId, null, "shared", null, pageable);

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

        Page<DocumentResponse> result = queryHelper.list(userId, "root", "private", null, pageable);

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

        when(documentRepository.findAllByParent_IdAndDeletedAtIsNull(eq(parentId), any(Pageable.class)))
                .thenReturn(childPage);
        when(documentRepository.countNonTrashedChildrenByParentIds(any())).thenReturn(List.of());
        when(collaboratorRepository.findDocumentIdsWithCollaborators(any())).thenReturn(List.of());

        Page<DocumentResponse> result = queryHelper.list(userId, parentId.toString(), "all", null, pageable);

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
    void list_childrenWithInvalidScope_throwsValidationFailed() {
        UUID parentId = UUID.randomUUID();
        assertThrows(
                ApiException.class,
                () -> queryHelper.list(userId, parentId.toString(), "shared", null, PageRequest.of(0, 20)));
    }

    @Test
    void list_childrenWithInvalidParentIdFormat_throwsValidationFailed() {
        assertThrows(
                ApiException.class, () -> queryHelper.list(userId, "invalid-uuid", "all", null, PageRequest.of(0, 20)));
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
        when(collaboratorRepository.findDocumentIdsWithCollaborators(any())).thenReturn(List.of());
        when(documentRepository.resolveTrashAccessBatch(eq(userId), anyString()))
                .thenReturn(List.<Object[]>of(new Object[] {trashedDoc.getId(), "OWNER"}));

        Page<DocumentResponse> result = queryHelper.list(userId, null, null, true, pageable);

        assertEquals(1, result.getContent().size());
        DocumentResponse item = result.getContent().get(0);
        assertEquals("Trashed Doc", item.title());
        assertNotNull(item.deletedAt());
        assertNotNull(item.purgeAt());
        assertEquals(DocumentAccessLevel.OWNER, item.accessLevel());
    }
}
