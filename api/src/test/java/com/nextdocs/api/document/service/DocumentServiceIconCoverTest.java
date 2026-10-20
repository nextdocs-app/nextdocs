package com.nextdocs.api.document.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.nextdocs.api.attachment.repository.AttachmentRepository;
import com.nextdocs.api.attachment.service.AttachmentService;
import com.nextdocs.api.attachment.storage.AttachmentStorage;
import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.config.DocumentProperties;
import com.nextdocs.api.document.dto.request.DocumentCoverRequest;
import com.nextdocs.api.document.dto.request.DocumentCreateRequest;
import com.nextdocs.api.document.dto.request.DocumentUpdateRequest;
import com.nextdocs.api.document.dto.response.DocumentCoverResponse;
import com.nextdocs.api.document.dto.response.DocumentIconResponse;
import com.nextdocs.api.document.dto.response.DocumentResponse;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.entity.DocumentCoverType;
import com.nextdocs.api.document.repository.DocumentCollaboratorRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.repository.UserDocumentOrderRepository;
import com.nextdocs.api.pageicon.PageIconType;
import com.nextdocs.api.pageicon.dto.request.PageIconRequest;
import com.nextdocs.api.pageicon.validation.PageIconValidator;
import com.nextdocs.api.workspace.service.WorkspaceService;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import tools.jackson.databind.ObjectMapper;

/**
 * Icon and cover behavior through {@link DocumentService} with a real validator
 * and a real builtin catalog, so the create/update/public paths are covered
 * together with the validation rules they rely on.
 */
@ExtendWith(MockitoExtension.class)
class DocumentServiceIconCoverTest {

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

    @Mock
    private AttachmentRepository attachmentRepository;

    @Mock
    private AttachmentStorage attachmentStorage;

    @Mock
    private WorkspaceService workspaceService;

    private DocumentService documentService;

    @BeforeEach
    void setUp() {
        DocumentProperties documentProperties = new DocumentProperties();
        documentProperties.setTrashRetentionDays(30);
        DocumentIconService iconService = new DocumentIconService(new ObjectMapper());
        iconService.loadCatalog();
        DocumentIconCoverApplier applier = new DocumentIconCoverApplier(
                new PageIconValidator(iconService, attachmentRepository, attachmentStorage));
        documentService = new DocumentService(
                documentRepository,
                collaboratorRepository,
                userDocumentOrderRepository,
                userRepository,
                documentProperties,
                permissionService,
                queryHelper,
                attachmentService,
                applier,
                workspaceService);
    }

    @Test
    void create_persistsIconAndCover() {
        UUID userId = UUID.randomUUID();
        User user = owner(userId);
        DocumentCreateRequest request = new DocumentCreateRequest(
                null,
                "Doc",
                "AQID",
                "Alice",
                null,
                null,
                null,
                new PageIconRequest("emoji", "📝"),
                new DocumentCoverRequest("link", "https://example.com/c.png", 0.25));

        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(documentRepository.saveAndFlush(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(userDocumentOrderRepository.saveAndFlush(any())).thenAnswer(invocation -> invocation.getArgument(0));

        DocumentService.CreateDocumentResult result = documentService.create(userId, request);

        assertTrue(result.created());
        ArgumentCaptor<Document> captor = ArgumentCaptor.forClass(Document.class);
        verify(documentRepository).saveAndFlush(captor.capture());
        assertEquals(PageIconType.EMOJI, captor.getValue().getIconType());
        assertEquals("📝", captor.getValue().getIconValue());
        assertEquals(DocumentCoverType.LINK, captor.getValue().getCoverType());
        assertEquals(0.25, captor.getValue().getCoverPosition());
        assertEquals(new DocumentIconResponse("emoji", "📝"), result.document().icon());
        assertEquals(
                new DocumentCoverResponse("link", "https://example.com/c.png", 0.25),
                result.document().cover());
    }

    @Test
    void create_unknownBuiltinIcon_failsBeforeSave() {
        UUID userId = UUID.randomUUID();
        when(userRepository.findById(userId)).thenReturn(Optional.of(owner(userId)));
        DocumentCreateRequest request = new DocumentCreateRequest(
                null, "Doc", "AQID", null, null, null, null, new PageIconRequest("builtin", "no-such-icon"), null);

        ApiException ex = assertThrows(ApiException.class, () -> documentService.create(userId, request));

        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
        verify(documentRepository, never()).saveAndFlush(any(Document.class));
    }

    @Test
    void update_setsBuiltinIconAndClearsCover() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = activeDoc(userId, documentId);
        document.setCoverType(DocumentCoverType.LINK);
        document.setCoverValue("https://example.com/old.png");
        document.setCoverPosition(0.1);

        when(documentRepository.findById(documentId)).thenReturn(Optional.of(document));
        when(permissionService.resolveAccess(userId, documentId)).thenReturn(DocumentAccessLevel.EDIT);
        when(documentRepository.save(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));

        DocumentResponse response = documentService.update(
                userId,
                documentId,
                new DocumentUpdateRequest(
                        null,
                        null,
                        null,
                        new PageIconRequest("BUILTIN", "add-circle-bold"),
                        new DocumentCoverRequest(null, null, null)));

        assertEquals(new DocumentIconResponse("builtin", "add-circle-bold"), response.icon());
        assertNull(response.cover());
        assertNull(document.getCoverType());
        assertNull(document.getCoverPosition());
    }

    @Test
    void update_invalidCoverLink_failsWithoutSave() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        when(documentRepository.findById(documentId)).thenReturn(Optional.of(activeDoc(userId, documentId)));
        when(permissionService.resolveAccess(userId, documentId)).thenReturn(DocumentAccessLevel.EDIT);

        ApiException ex = assertThrows(
                ApiException.class,
                () -> documentService.update(
                        userId,
                        documentId,
                        new DocumentUpdateRequest(
                                null,
                                null,
                                null,
                                null,
                                new DocumentCoverRequest("LINK", "http://example.com/c.png", null))));

        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
        verify(documentRepository, never()).save(any(Document.class));
    }

    @Test
    void update_absentIconAndCover_leaveThemUntouched() {
        UUID userId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        Document document = activeDoc(userId, documentId);
        document.setIconType(PageIconType.EMOJI);
        document.setIconValue("📝");

        when(documentRepository.findById(documentId)).thenReturn(Optional.of(document));
        when(permissionService.resolveAccess(userId, documentId)).thenReturn(DocumentAccessLevel.EDIT);
        when(documentRepository.save(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));

        DocumentResponse response = documentService.update(
                userId, documentId, new DocumentUpdateRequest("Renamed", null, null, null, null));

        assertEquals("Renamed", response.title());
        assertEquals(new DocumentIconResponse("emoji", "📝"), response.icon());
    }

    @Test
    void updatePublic_appliesIconAndCover() {
        UUID documentId = UUID.randomUUID();
        Document document = activeDoc(UUID.randomUUID(), documentId);

        when(documentRepository.findByIdAndDeletedAtIsNull(documentId)).thenReturn(Optional.of(document));
        when(permissionService.resolvePublicAccess(documentId)).thenReturn(DocumentAccessLevel.EDIT);
        when(documentRepository.save(any(Document.class))).thenAnswer(invocation -> invocation.getArgument(0));

        DocumentResponse response = documentService.updatePublic(
                documentId,
                new DocumentUpdateRequest(
                        null,
                        null,
                        null,
                        new PageIconRequest("EMOJI", "🚀"),
                        new DocumentCoverRequest("LINK", "https://example.com/c.gif", null)));

        assertEquals(new DocumentIconResponse("emoji", "🚀"), response.icon());
        assertEquals(new DocumentCoverResponse("link", "https://example.com/c.gif", 0.5), response.cover());
    }

    private static User owner(UUID userId) {
        return User.builder()
                .id(userId)
                .email("alice@example.com")
                .displayName("Alice")
                .build();
    }

    private static Document activeDoc(UUID ownerId, UUID documentId) {
        return Document.builder()
                .id(documentId)
                .user(owner(ownerId))
                .title("Doc")
                .yjsState(new byte[] {1})
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .updatedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();
    }
}
