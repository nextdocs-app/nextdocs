package com.nextdocs.api.document.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.nextdocs.api.attachment.service.AttachmentService;
import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.config.DocumentProperties;
import com.nextdocs.api.document.dto.request.DocumentCreateRequest;
import com.nextdocs.api.document.dto.response.DocumentResponse;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.entity.UserDocumentOrder;
import com.nextdocs.api.document.repository.DocumentCollaboratorRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.repository.UserDocumentOrderRepository;
import com.nextdocs.api.space.entity.Space;
import com.nextdocs.api.space.service.SpaceAccessService;
import com.nextdocs.api.space.service.SpaceAccessService.SpaceContext;
import com.nextdocs.api.workspace.service.WorkspaceService;
import java.nio.charset.StandardCharsets;
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

@ExtendWith(MockitoExtension.class)
class DocumentSpaceServiceTest {

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

    @Mock
    private DocumentListQueryHelper queryHelper;

    @Mock
    private AttachmentService attachmentService;

    @Mock
    private DocumentIconCoverApplier iconCoverApplier;

    @Mock
    private WorkspaceService workspaceService;

    @Mock
    private SpaceAccessService spaceAccessService;

    private DocumentService documentService;

    private UUID userId;
    private User user;
    private Space space;

    @BeforeEach
    void setUp() {
        DocumentProperties properties = new DocumentProperties();
        documentService = new DocumentService(
                documentRepository,
                collaboratorRepository,
                userDocumentOrderRepository,
                userRepository,
                properties,
                permissionService,
                queryHelper,
                attachmentService,
                iconCoverApplier,
                workspaceService,
                spaceAccessService);

        userId = UUID.randomUUID();
        user = User.builder().email("alice@example.com").displayName("Alice").build();
        user.setId(userId);
        space = Space.builder().id(UUID.randomUUID()).name("Engineering").build();
    }

    private SpaceContext spaceContext(DocumentAccessLevel level) {
        return new SpaceContext(space, null, level);
    }

    private Document rootPage() {
        return Document.builder()
                .id(UUID.randomUUID())
                .user(user)
                .title("Page")
                .yjsState("seed".getBytes(StandardCharsets.UTF_8))
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();
    }

    @Test
    void create_withASpace_requiresEditOnThatSpaceAndStoresTheAnchor() {
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(spaceAccessService.requireEdit(userId, space.getId())).thenReturn(spaceContext(DocumentAccessLevel.EDIT));
        when(documentRepository.findMinSpaceSiblingOrderKey(eq(space.getId()), any()))
                .thenReturn(Optional.of("a5"));
        when(documentRepository.saveAndFlush(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));
        lenient()
                .when(userDocumentOrderRepository.findMinOrderKeyByUserId(eq(userId), any()))
                .thenReturn(Optional.empty());

        DocumentService.CreateDocumentResult result = documentService.create(
                userId,
                new DocumentCreateRequest(null, "Page", "AQID", "Alice", null, space.getId(), null, null, null, null));

        ArgumentCaptor<Document> captor = ArgumentCaptor.forClass(Document.class);
        verify(documentRepository).saveAndFlush(captor.capture());
        assertThat(captor.getValue().getSpace()).isSameAs(space);
        assertThat(captor.getValue().getParent()).isNull();
        // The space owns the order, so the key lives on the page before every other space
        // page and the caller receives that shared key, not their personal one.
        assertThat(captor.getValue().getSiblingOrderKey()).isNotNull().isLessThan("a5");
        assertThat(result.created()).isTrue();
        assertThat(result.document().spaceId()).isEqualTo(space.getId());
        assertThat(result.document().orderKey()).isEqualTo(captor.getValue().getSiblingOrderKey());
    }

    @Test
    void create_withASpaceAndASpaceSibling_usesTheSharedKeyAndTopsThePersonalRow() {
        UUID prevSiblingId = UUID.randomUUID();
        Document prevSibling = Document.builder()
                .id(prevSiblingId)
                .user(user)
                .space(space)
                .siblingOrderKey("a5")
                .build();

        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(spaceAccessService.requireEdit(userId, space.getId())).thenReturn(spaceContext(DocumentAccessLevel.EDIT));
        when(documentRepository.findByIdAndDeletedAtIsNull(prevSiblingId)).thenReturn(Optional.of(prevSibling));
        when(documentRepository.saveAndFlush(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(userDocumentOrderRepository.findMinOrderKeyByUserId(eq(userId), any()))
                .thenReturn(Optional.of("a0"));
        when(userDocumentOrderRepository.saveAndFlush(any(UserDocumentOrder.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        DocumentService.CreateDocumentResult result = documentService.create(
                userId,
                new DocumentCreateRequest(
                        null, "Page", "AQID", "Alice", null, space.getId(), prevSiblingId, null, null, null));

        // The space sibling positions the page in the shared order...
        assertThat(result.document().orderKey()).isNotNull().isGreaterThan("a5");
        // ...while the personal row, only used after detach, ignores that key and goes top.
        ArgumentCaptor<UserDocumentOrder> orderCaptor = ArgumentCaptor.forClass(UserDocumentOrder.class);
        verify(userDocumentOrderRepository).saveAndFlush(orderCaptor.capture());
        assertThat(orderCaptor.getValue().getOrderKey()).isLessThan("a0");
    }

    @Test
    void create_withASpaceAndAParent_isRejectedBeforeAnyLookup() {
        assertThatThrownBy(() -> documentService.create(
                        userId,
                        new DocumentCreateRequest(
                                null,
                                "Page",
                                "AQID",
                                "Alice",
                                UUID.randomUUID(),
                                space.getId(),
                                null,
                                null,
                                null,
                                null)))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.VALIDATION_FAILED));
        verify(spaceAccessService, never()).requireEdit(any(), any());
        verify(documentRepository, never()).saveAndFlush(any(Document.class));
    }

    @Test
    void create_withASpace_propagatesTheContentGate() {
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(spaceAccessService.requireEdit(userId, space.getId())).thenThrow(new ApiException(ErrorCode.NOT_FOUND));

        assertThatThrownBy(() -> documentService.create(
                        userId,
                        new DocumentCreateRequest(
                                null, "Page", "AQID", "Alice", null, space.getId(), null, null, null, null)))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.NOT_FOUND));
    }

    @Test
    void assignSpace_filesAnActiveRootPage() {
        Document page = rootPage();
        when(permissionService.requireEditAccess(userId, page.getId())).thenReturn(page);
        when(spaceAccessService.requireActiveAdministration(userId, space.getId()))
                .thenReturn(spaceContext(DocumentAccessLevel.OWNER));
        when(documentRepository.findMaxSpaceSiblingOrderKey(space.getId(), page.getId()))
                .thenReturn(Optional.of("a5"));
        when(documentRepository.save(page)).thenReturn(page);

        DocumentResponse response = documentService.assignSpace(userId, page.getId(), space.getId());

        assertThat(page.getSpace()).isSameAs(space);
        // Attaching appends inside the space's shared order, not the caller's.
        assertThat(page.getSiblingOrderKey()).isNotNull().isGreaterThan("a5");
        assertThat(response.orderKey()).isEqualTo(page.getSiblingOrderKey());
        assertThat(response.spaceId()).isEqualTo(space.getId());
        verify(documentRepository).save(page);
    }

    @Test
    void assignSpace_rejectsANestedPage() {
        Document page = rootPage();
        page.setParent(rootPage());
        when(spaceAccessService.requireActiveAdministration(userId, space.getId()))
                .thenReturn(spaceContext(DocumentAccessLevel.OWNER));
        when(permissionService.requireEditAccess(userId, page.getId())).thenReturn(page);

        assertThatThrownBy(() -> documentService.assignSpace(userId, page.getId(), space.getId()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.VALIDATION_FAILED));
        verify(documentRepository, never()).save(any(Document.class));
    }

    @Test
    void assignSpace_archivedSpaceAnswersConflictBeforeThePageGrantIsChecked() {
        Document page = rootPage();
        when(spaceAccessService.requireActiveAdministration(userId, space.getId()))
                .thenThrow(new ApiException(ErrorCode.CONFLICT));

        assertThatThrownBy(() -> documentService.assignSpace(userId, page.getId(), space.getId()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.CONFLICT));
        // The page's archived VIEW cap must not turn the space's answer into a 403.
        verify(permissionService, never()).requireEditAccess(any(), any());
    }

    @Test
    void assignSpace_refusesAPageInAnotherSpace() {
        Document page = rootPage();
        page.setSpace(Space.builder().id(UUID.randomUUID()).name("Other").build());
        when(permissionService.requireEditAccess(userId, page.getId())).thenReturn(page);
        when(spaceAccessService.requireActiveAdministration(userId, space.getId()))
                .thenReturn(spaceContext(DocumentAccessLevel.OWNER));

        assertThatThrownBy(() -> documentService.assignSpace(userId, page.getId(), space.getId()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.CONFLICT));
    }

    @Test
    void assignSpace_isIdempotentForTheSameSpace() {
        Document page = rootPage();
        page.setSpace(space);
        when(permissionService.requireEditAccess(userId, page.getId())).thenReturn(page);
        when(spaceAccessService.requireActiveAdministration(userId, space.getId()))
                .thenReturn(spaceContext(DocumentAccessLevel.OWNER));

        DocumentResponse response = documentService.assignSpace(userId, page.getId(), space.getId());

        assertThat(response.spaceId()).isEqualTo(space.getId());
        verify(documentRepository, never()).save(any(Document.class));
    }

    @Test
    void clearSpace_returnsThePageToPrivateAndTopsTheOwnersNavigation() {
        Document page = rootPage();
        page.setSpace(space);
        page.setSiblingOrderKey("a1");
        when(permissionService.requireEditAccess(userId, page.getId())).thenReturn(page);
        when(spaceAccessService.requireActiveAdministration(userId, space.getId()))
                .thenReturn(spaceContext(DocumentAccessLevel.OWNER));
        when(userDocumentOrderRepository.existsByUser_IdAndDocument_Id(userId, page.getId()))
                .thenReturn(false);
        when(userDocumentOrderRepository.findMinOrderKeyByUserId(userId, page.getId()))
                .thenReturn(Optional.of("a2"));
        when(userDocumentOrderRepository.saveAndFlush(any(UserDocumentOrder.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        documentService.clearSpace(userId, page.getId(), space.getId());

        assertThat(page.getSpace()).isNull();
        // Root-page order outside a space is personal, so the shared key is meaningless.
        assertThat(page.getSiblingOrderKey()).isNull();
        verify(documentRepository).save(page);

        // The page returns to the owner's Private section, which needs a personal row;
        // detaching puts it before every existing root page.
        ArgumentCaptor<UserDocumentOrder> captor = ArgumentCaptor.forClass(UserDocumentOrder.class);
        verify(userDocumentOrderRepository).saveAndFlush(captor.capture());
        UserDocumentOrder order = captor.getValue();
        assertThat(order.getUser()).isSameAs(user);
        assertThat(order.getDocument()).isSameAs(page);
        assertThat(order.getOrderKey()).isNotNull().isLessThan("a2");
    }

    @Test
    void clearSpace_keepsAnExistingPersonalRow() {
        Document page = rootPage();
        page.setSpace(space);
        page.setSiblingOrderKey("a1");
        when(permissionService.requireEditAccess(userId, page.getId())).thenReturn(page);
        when(spaceAccessService.requireActiveAdministration(userId, space.getId()))
                .thenReturn(spaceContext(DocumentAccessLevel.OWNER));
        when(userDocumentOrderRepository.existsByUser_IdAndDocument_Id(userId, page.getId()))
                .thenReturn(true);

        documentService.clearSpace(userId, page.getId(), space.getId());

        assertThat(page.getSpace()).isNull();
        assertThat(page.getSiblingOrderKey()).isNull();
        // A personal row already gives the page a position; detaching must not reset it.
        verify(userDocumentOrderRepository, never()).saveAndFlush(any(UserDocumentOrder.class));
        verify(userDocumentOrderRepository, never()).findMinOrderKeyByUserId(any(), any());
    }

    @Test
    void clearSpace_rejectsAPageThatIsNotInTheNamedSpace() {
        Document page = rootPage();
        page.setSpace(Space.builder().id(UUID.randomUUID()).name("Other").build());
        when(spaceAccessService.requireActiveAdministration(userId, space.getId()))
                .thenReturn(spaceContext(DocumentAccessLevel.OWNER));
        when(permissionService.requireEditAccess(userId, page.getId())).thenReturn(page);

        assertThatThrownBy(() -> documentService.clearSpace(userId, page.getId(), space.getId()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.NOT_FOUND));
    }

    @Test
    void clearSpace_rejectsAPageOutsideAnySpace() {
        Document page = rootPage();
        when(spaceAccessService.requireActiveAdministration(userId, space.getId()))
                .thenReturn(spaceContext(DocumentAccessLevel.OWNER));
        when(permissionService.requireEditAccess(userId, page.getId())).thenReturn(page);

        assertThatThrownBy(() -> documentService.clearSpace(userId, page.getId(), space.getId()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.NOT_FOUND));
    }

    private Document trashedSpacePage() {
        Document page = rootPage();
        page.setSpace(space);
        page.setDeletedAt(OffsetDateTime.now());
        return page;
    }

    private void stubRestoreTail(Document page) {
        when(documentRepository.saveAndFlush(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(documentRepository.findAllByParent_IdIn(any())).thenReturn(List.of());
        when(collaboratorRepository.findAllByDocument_Id(page.getId())).thenReturn(List.of());
        when(documentRepository.existsNonTrashedChildrenByParentId(page.getId()))
                .thenReturn(false);
        when(collaboratorRepository.existsByDocument_Id(page.getId())).thenReturn(false);
        when(permissionService.resolveAccess(userId, page.getId())).thenReturn(DocumentAccessLevel.EDIT);
    }

    @Test
    void restore_spacePage_regeneratesAMissingSharedKeyWithoutTouchingPersonalOrder() {
        Document page = trashedSpacePage();
        page.setSiblingOrderKey(null);
        when(permissionService.requireTrashEditAccess(userId, page.getId())).thenReturn(page);
        when(documentRepository.findMaxSpaceSiblingOrderKey(space.getId(), page.getId()))
                .thenReturn(Optional.of("a5"));
        stubRestoreTail(page);

        DocumentResponse response = documentService.restore(userId, page.getId());

        assertThat(page.getSiblingOrderKey()).isNotNull().isGreaterThan("a5");
        assertThat(response.orderKey()).isEqualTo(page.getSiblingOrderKey());
        // The shared key is the page's only position; no personal row is written.
        verifyNoInteractions(userDocumentOrderRepository);
    }

    @Test
    void restore_spacePage_keepsAValidSharedKey() {
        Document page = trashedSpacePage();
        page.setSiblingOrderKey("a1");
        when(permissionService.requireTrashEditAccess(userId, page.getId())).thenReturn(page);
        stubRestoreTail(page);

        DocumentResponse response = documentService.restore(userId, page.getId());

        assertThat(page.getSiblingOrderKey()).isEqualTo("a1");
        assertThat(response.orderKey()).isEqualTo("a1");
        verify(documentRepository, never()).findMaxSpaceSiblingOrderKey(any(), any());
    }
}
