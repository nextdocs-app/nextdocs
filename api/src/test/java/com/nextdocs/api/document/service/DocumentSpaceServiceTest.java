package com.nextdocs.api.document.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
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
import com.nextdocs.api.document.repository.DocumentCollaboratorRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.repository.UserDocumentOrderRepository;
import com.nextdocs.api.space.entity.Space;
import com.nextdocs.api.space.service.SpaceAccessService;
import com.nextdocs.api.space.service.SpaceAccessService.SpaceContext;
import com.nextdocs.api.workspace.service.WorkspaceService;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
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
        assertThat(result.created()).isTrue();
        assertThat(result.document().spaceId()).isEqualTo(space.getId());
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
        when(spaceAccessService.requireAdministration(userId, space.getId()))
                .thenReturn(spaceContext(DocumentAccessLevel.OWNER));
        when(documentRepository.save(page)).thenReturn(page);

        DocumentResponse response = documentService.assignSpace(userId, page.getId(), space.getId());

        assertThat(page.getSpace()).isSameAs(space);
        assertThat(response.spaceId()).isEqualTo(space.getId());
        verify(documentRepository).save(page);
    }

    @Test
    void assignSpace_rejectsANestedPage() {
        Document page = rootPage();
        page.setParent(rootPage());
        when(permissionService.requireEditAccess(userId, page.getId())).thenReturn(page);

        assertThatThrownBy(() -> documentService.assignSpace(userId, page.getId(), space.getId()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.VALIDATION_FAILED));
        verify(spaceAccessService, never()).requireAdministration(any(), any());
    }

    @Test
    void assignSpace_refusesAPageInAnotherSpace() {
        Document page = rootPage();
        page.setSpace(Space.builder().id(UUID.randomUUID()).name("Other").build());
        when(permissionService.requireEditAccess(userId, page.getId())).thenReturn(page);
        when(spaceAccessService.requireAdministration(userId, space.getId()))
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
        when(spaceAccessService.requireAdministration(userId, space.getId()))
                .thenReturn(spaceContext(DocumentAccessLevel.OWNER));

        DocumentResponse response = documentService.assignSpace(userId, page.getId(), space.getId());

        assertThat(response.spaceId()).isEqualTo(space.getId());
        verify(documentRepository, never()).save(any(Document.class));
    }

    @Test
    void clearSpace_returnsThePageToPrivate() {
        Document page = rootPage();
        page.setSpace(space);
        when(permissionService.requireEditAccess(userId, page.getId())).thenReturn(page);
        when(spaceAccessService.requireAdministration(userId, space.getId()))
                .thenReturn(spaceContext(DocumentAccessLevel.OWNER));

        documentService.clearSpace(userId, page.getId(), space.getId());

        assertThat(page.getSpace()).isNull();
        verify(documentRepository).save(page);
    }

    @Test
    void clearSpace_rejectsAPageThatIsNotInTheNamedSpace() {
        Document page = rootPage();
        page.setSpace(Space.builder().id(UUID.randomUUID()).name("Other").build());
        when(permissionService.requireEditAccess(userId, page.getId())).thenReturn(page);

        assertThatThrownBy(() -> documentService.clearSpace(userId, page.getId(), space.getId()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.NOT_FOUND));
    }

    @Test
    void clearSpace_rejectsAPageOutsideAnySpace() {
        Document page = rootPage();
        when(permissionService.requireEditAccess(userId, page.getId())).thenReturn(page);

        assertThatThrownBy(() -> documentService.clearSpace(userId, page.getId(), space.getId()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.NOT_FOUND));
    }
}
