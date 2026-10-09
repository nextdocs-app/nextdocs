package com.nextdocs.api.attachment.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.nextdocs.api.attachment.config.AttachmentProperties;
import com.nextdocs.api.attachment.dto.response.AttachmentResponse;
import com.nextdocs.api.attachment.dto.response.AttachmentUrlResponse;
import com.nextdocs.api.attachment.entity.Attachment;
import com.nextdocs.api.attachment.repository.AttachmentRepository;
import com.nextdocs.api.attachment.storage.AttachmentStorage;
import com.nextdocs.api.attachment.storage.StoredAttachment;
import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.entity.DocumentGeneralAccessMode;
import com.nextdocs.api.document.service.PermissionService;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.util.unit.DataSize;
import org.springframework.web.multipart.MultipartFile;

@ExtendWith(MockitoExtension.class)
class AttachmentServiceTest {

    private static final String SIGNING_SECRET = "unit-test-attachment-signing-secret-0123456789";

    @Mock
    private AttachmentRepository attachmentRepository;

    @Mock
    private UserRepository userRepository;

    @Mock
    private PermissionService permissionService;

    @Mock
    private AttachmentStorage attachmentStorage;

    @Mock
    private AttachmentQuotaService quotaService;

    private AttachmentProperties properties;
    private AttachmentSigner signer;
    private AttachmentMetadataWriter metadataWriter;
    private AttachmentService attachmentService;

    private UUID userId;
    private UUID documentId;
    private User user;
    private Document document;

    @BeforeEach
    void setUp() {
        properties = new AttachmentProperties();
        properties.setStoragePath("/tmp/nextdocs-attachment-tests");
        properties.setMaxFileSize(DataSize.ofMegabytes(25));
        properties.setUrlTtl(Duration.ofHours(1));
        properties.setSigningSecret(SIGNING_SECRET);
        signer = new AttachmentSigner(properties, SIGNING_SECRET);
        metadataWriter = new AttachmentMetadataWriter(attachmentRepository, attachmentStorage);
        attachmentService = new AttachmentService(
                attachmentRepository,
                userRepository,
                permissionService,
                attachmentStorage,
                signer,
                quotaService,
                properties,
                metadataWriter);

        userId = UUID.randomUUID();
        documentId = UUID.randomUUID();
        user = User.builder()
                .id(userId)
                .email("alice@example.com")
                .displayName("Alice")
                .build();
        document = Document.builder()
                .id(documentId)
                .user(user)
                .title("Doc")
                .yjsState(new byte[] {1, 2, 3})
                .build();
    }

    // --- upload ---------------------------------------------------------------

    @Test
    void upload_reservesQuotaBeforeWritingToStorage() {
        stubStoragePut();
        when(permissionService.requireEditAccess(userId, documentId)).thenReturn(document);
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(attachmentRepository.saveAndFlush(any(Attachment.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        attachmentService.upload(userId, documentId, multipartFile("a.png", "image/png", "hello"));

        // Admission control runs first so an over-quota upload never reaches the disk.
        InOrder inOrder = inOrder(quotaService, attachmentStorage);
        inOrder.verify(quotaService).reserve(userId, 5L);
        inOrder.verify(attachmentStorage).put(anyString(), any(InputStream.class));
    }

    @Test
    void upload_overQuota_isRejectedBeforeWritingAnything() {
        when(permissionService.requireEditAccess(userId, documentId)).thenReturn(document);
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        doThrow(new ApiException(ErrorCode.PAYLOAD_TOO_LARGE))
                .when(quotaService)
                .reserve(userId, 5L);

        assertApiError(
                ErrorCode.PAYLOAD_TOO_LARGE,
                () -> attachmentService.upload(userId, documentId, multipartFile("a.png", "image/png", "hello")));

        verifyNoInteractions(attachmentStorage);
        verify(attachmentRepository, never()).saveAndFlush(any());
    }

    @Test
    void upload_writesToStorageWithoutAnActiveTransaction() {
        // The disk write is the slow part of an upload; holding a pooled connection for it
        // would starve every other request. The reservation's transaction must be done by then.
        AtomicBoolean transactionActiveDuringPut = new AtomicBoolean();
        doAnswer(invocation -> {
                    transactionActiveDuringPut.set(TransactionSynchronizationManager.isActualTransactionActive());
                    try (InputStream inputStream = invocation.getArgument(1)) {
                        inputStream.transferTo(OutputStream.nullOutputStream());
                    }
                    return null;
                })
                .when(attachmentStorage)
                .put(anyString(), any(InputStream.class));
        when(permissionService.requireEditAccess(userId, documentId)).thenReturn(document);
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(attachmentRepository.saveAndFlush(any(Attachment.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        attachmentService.upload(userId, documentId, multipartFile("a.png", "image/png", "data"));

        assertThat(transactionActiveDuringPut).isFalse();
    }

    @Test
    void upload_reconcilesReservationWithTheBytesActuallyStored() {
        stubStoragePut();
        when(permissionService.requireEditAccess(userId, documentId)).thenReturn(document);
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(attachmentRepository.saveAndFlush(any(Attachment.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        // Declares one byte but streams five: the missing four must be reserved too, or an
        // under-reporting container gets a quota discount.
        AttachmentResponse response = attachmentService.upload(
                userId, documentId, underReportingMultipartFile("big.png", "image/png", "hello"));

        assertEquals(5L, response.sizeBytes());
        InOrder inOrder = inOrder(quotaService);
        inOrder.verify(quotaService).reserve(userId, 1L);
        inOrder.verify(quotaService).reserve(userId, 4L);
    }

    @Test
    void upload_storesFileAndPersistsMetadata() {
        stubStoragePut();
        when(permissionService.requireEditAccess(userId, documentId)).thenReturn(document);
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(attachmentRepository.saveAndFlush(any(Attachment.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        AttachmentResponse response = attachmentService.upload(
                userId,
                documentId,
                multipartFile("..\\screens\\Screen Shot.PNG", "image/png; charset=binary", "hello"));

        assertEquals("Screen Shot.PNG", response.fileName());
        assertEquals("image/png", response.contentType());
        assertEquals(5L, response.sizeBytes());
        assertEquals("/api/v1/attachments/" + response.id(), response.url());

        verify(attachmentStorage).put(eq(documentId + "/" + response.id()), any(InputStream.class));
        ArgumentCaptor<Attachment> captor = ArgumentCaptor.forClass(Attachment.class);
        verify(attachmentRepository).saveAndFlush(captor.capture());
        assertEquals(documentId + "/" + response.id(), captor.getValue().getStorageKey());
        assertEquals(
                "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
                captor.getValue().getSha256());
    }

    @Test
    void upload_usesPersistedEntityForTheResponse() {
        stubStoragePut();
        when(permissionService.requireEditAccess(userId, documentId)).thenReturn(document);
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        OffsetDateTime createdAt = OffsetDateTime.now();
        when(attachmentRepository.saveAndFlush(any(Attachment.class))).thenAnswer(invocation -> {
            // Manually assigned ids take the merge path, which returns a managed copy:
            // the instance passed in keeps a null createdAt.
            Attachment input = invocation.getArgument(0);
            return Attachment.builder()
                    .id(input.getId())
                    .document(input.getDocument())
                    .uploadedBy(input.getUploadedBy())
                    .fileName(input.getFileName())
                    .contentType(input.getContentType())
                    .sizeBytes(input.getSizeBytes())
                    .storageKey(input.getStorageKey())
                    .sha256(input.getSha256())
                    .createdAt(createdAt)
                    .build();
        });

        AttachmentResponse response =
                attachmentService.upload(userId, documentId, multipartFile("a.png", "image/png", "hello"));

        assertEquals(createdAt, response.createdAt());
    }

    @Test
    void upload_persistsBytesActuallyCopiedToStorage() {
        stubStoragePut();
        when(permissionService.requireEditAccess(userId, documentId)).thenReturn(document);
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(attachmentRepository.saveAndFlush(any(Attachment.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        // The multipart container may under-report its size; the bytes on disk win.
        MultipartFile file = underReportingMultipartFile("a.png", "image/png", "hello");

        AttachmentResponse response = attachmentService.upload(userId, documentId, file);

        assertEquals(5L, response.sizeBytes());
        ArgumentCaptor<Attachment> captor = ArgumentCaptor.forClass(Attachment.class);
        verify(attachmentRepository).saveAndFlush(captor.capture());
        assertEquals(5L, captor.getValue().getSizeBytes());
    }

    @Test
    void upload_sanitizesTraversalAndBlankFileNamesToFile() {
        List<Attachment> attachments = captureUploads(new String[] {"   ", null, "../..", "./.."}, "image/png");

        assertThat(attachments).extracting(Attachment::getFileName).containsOnly("file");
    }

    @Test
    void upload_truncatesFileNamesLongerThan255Characters() {
        String longName = "a".repeat(300) + ".png";
        List<Attachment> attachments = captureUploads(new String[] {longName}, "image/png");

        assertEquals(255, attachments.get(0).getFileName().length());
        assertEquals(longName.substring(0, 255), attachments.get(0).getFileName());
    }

    @Test
    void upload_fallsBackToOctetStreamForUnsupportedContentTypes() {
        List<Attachment> attachments = captureUploads(
                new String[] {"a.bin", "b.bin", "c.bin", "d.bin"},
                new String[] {null, "not a mime type", "text/" + "a".repeat(300), " image/png "});

        assertThat(attachments.get(0).getContentType()).isEqualTo("application/octet-stream");
        assertThat(attachments.get(1).getContentType()).isEqualTo("application/octet-stream");
        assertThat(attachments.get(2).getContentType()).isEqualTo("application/octet-stream");
        // A padded but valid content type is still accepted after normalization.
        assertThat(attachments.get(3).getContentType()).isEqualTo("image/png");
    }

    @Test
    void upload_rejectsEmptyFile() {
        when(permissionService.requireEditAccess(userId, documentId)).thenReturn(document);

        assertApiError(
                ErrorCode.VALIDATION_FAILED,
                () -> attachmentService.upload(userId, documentId, multipartFile("empty.txt", "text/plain", "")));

        verifyNoInteractions(attachmentStorage);
    }

    @Test
    void upload_rejectsFileLargerThanConfiguredLimit() {
        properties.setMaxFileSize(DataSize.ofBytes(4));
        when(permissionService.requireEditAccess(userId, documentId)).thenReturn(document);

        assertApiError(
                ErrorCode.PAYLOAD_TOO_LARGE,
                () -> attachmentService.upload(userId, documentId, multipartFile("big.txt", "text/plain", "12345")));

        verifyNoInteractions(attachmentStorage);
    }

    @Test
    void upload_rejectsOversizedFileThatLiesAboutItsDeclaredSize() {
        stubStoragePut();
        properties.setMaxFileSize(DataSize.ofBytes(4));
        when(permissionService.requireEditAccess(userId, documentId)).thenReturn(document);
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));

        // The declared size passes the pre-check, but 5 bytes are actually read: the
        // persisted size must enforce the limit and the written file must be reclaimed.
        assertApiError(
                ErrorCode.PAYLOAD_TOO_LARGE,
                () -> attachmentService.upload(
                        userId, documentId, underReportingMultipartFile("big.png", "image/png", "hello")));

        verify(attachmentStorage).delete(anyString());
        verify(attachmentRepository, never()).saveAndFlush(any());
    }

    @Test
    void upload_acceptsFileExactlyAtTheLimit() {
        stubStoragePut();
        properties.setMaxFileSize(DataSize.ofBytes(5));
        when(permissionService.requireEditAccess(userId, documentId)).thenReturn(document);
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(attachmentRepository.saveAndFlush(any(Attachment.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        AttachmentResponse response =
                attachmentService.upload(userId, documentId, multipartFile("exact.png", "image/png", "hello"));

        assertEquals(5L, response.sizeBytes());
    }

    @Test
    void upload_negativeDeclaredSize_clampsReservationToZero() {
        stubStoragePut();
        when(permissionService.requireEditAccess(userId, documentId)).thenReturn(document);
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(attachmentRepository.saveAndFlush(any(Attachment.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));
        MultipartFile file = multipartFile("a.png", "image/png", "hello");
        when(file.getSize()).thenReturn(-1L);

        AttachmentResponse response = attachmentService.upload(userId, documentId, file);

        // Five bytes land on disk from a -1 declaration: without the clamp the
        // reconciliation would reserve six and over-hold one byte of quota.
        assertEquals(5L, response.sizeBytes());
        verify(quotaService).reserve(userId, 5L);
        verify(quotaService, never()).release(eq(userId), anyLong());
    }

    @Test
    void upload_uploaderNotFound_throwsNotFound() {
        when(permissionService.requireEditAccess(userId, documentId)).thenReturn(document);
        when(userRepository.findById(userId)).thenReturn(Optional.empty());

        assertApiError(
                ErrorCode.NOT_FOUND,
                () -> attachmentService.upload(userId, documentId, multipartFile("a.png", "image/png", "data")));

        verifyNoInteractions(attachmentStorage);
    }

    @Test
    void upload_withoutEditAccess_propagatesForbidden() {
        doThrow(new ApiException(ErrorCode.FORBIDDEN)).when(permissionService).requireEditAccess(userId, documentId);

        assertApiError(
                ErrorCode.FORBIDDEN,
                () -> attachmentService.upload(userId, documentId, multipartFile("a.png", "image/png", "data")));

        verifyNoInteractions(attachmentStorage);
        verify(attachmentRepository, never()).saveAndFlush(any());
    }

    @Test
    void upload_storageFailure_doesNotPersistMetadata() {
        when(permissionService.requireEditAccess(userId, documentId)).thenReturn(document);
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        doThrow(new ApiException(ErrorCode.INTERNAL_ERROR))
                .when(attachmentStorage)
                .put(anyString(), any(InputStream.class));

        assertApiError(
                ErrorCode.INTERNAL_ERROR,
                () -> attachmentService.upload(userId, documentId, multipartFile("a.png", "image/png", "data")));

        verify(attachmentRepository, never()).saveAndFlush(any());
        // The reservation must not outlive the failed upload.
        verify(quotaService).release(userId, 4L);
    }

    @Test
    void upload_ignoresSkippedBytesWhenPersistingTheSize() {
        doAnswer(invocation -> {
                    try (InputStream inputStream = invocation.getArgument(1)) {
                        // Two bytes are advanced over without being stored or hashed: counting
                        // them would let the persisted size disagree with the digest.
                        inputStream.skip(2);
                        inputStream.transferTo(OutputStream.nullOutputStream());
                    }
                    return null;
                })
                .when(attachmentStorage)
                .put(anyString(), any(InputStream.class));
        when(permissionService.requireEditAccess(userId, documentId)).thenReturn(document);
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(attachmentRepository.saveAndFlush(any(Attachment.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        AttachmentResponse response =
                attachmentService.upload(userId, documentId, multipartFile("a.png", "image/png", "hello"));

        assertEquals(3L, response.sizeBytes());
        // Declared 5 bytes but stored 3: the 2-byte over-report must be handed back, or
        // no-op'ing the delta<0 branch leaves quota permanently over-reserved.
        verify(quotaService).release(userId, 2L);
    }

    @Test
    void upload_cleanupFailure_doesNotMaskTheOriginalError() {
        when(permissionService.requireEditAccess(userId, documentId)).thenReturn(document);
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        doThrow(new ApiException(ErrorCode.INTERNAL_ERROR))
                .when(attachmentStorage)
                .put(anyString(), any(InputStream.class));
        // Both cleanup steps fail too; the caller must still see the real upload failure.
        doThrow(new IllegalStateException("delete failed"))
                .when(attachmentStorage)
                .delete(anyString());
        doThrow(new IllegalStateException("release failed")).when(quotaService).release(userId, 4L);

        assertApiError(
                ErrorCode.INTERNAL_ERROR,
                () -> attachmentService.upload(userId, documentId, multipartFile("a.png", "image/png", "data")));
    }

    @Test
    void upload_metadataFailure_deletesStoredFile() {
        stubStoragePut();
        when(permissionService.requireEditAccess(userId, documentId)).thenReturn(document);
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(attachmentRepository.saveAndFlush(any(Attachment.class)))
                .thenThrow(new RuntimeException("constraint violation"));

        assertThatThrownBy(
                        () -> attachmentService.upload(userId, documentId, multipartFile("a.png", "image/png", "data")))
                .isInstanceOf(RuntimeException.class);

        verify(attachmentStorage).delete(anyString());
        verify(quotaService).release(userId, 4L);
    }

    @Test
    void upload_rollbackAfterFlush_deletesStoredFile() {
        stubStoragePut();
        when(permissionService.requireEditAccess(userId, documentId)).thenReturn(document);
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(attachmentRepository.saveAndFlush(any(Attachment.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        AttachmentResponse response;
        List<TransactionSynchronization> synchronizations;
        TransactionSynchronizationManager.initSynchronization();
        try {
            response = attachmentService.upload(userId, documentId, multipartFile("a.png", "image/png", "data"));
            synchronizations = TransactionSynchronizationManager.getSynchronizations();
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }

        assertThat(synchronizations).hasSize(1);
        synchronizations.get(0).afterCompletion(TransactionSynchronization.STATUS_ROLLED_BACK);

        verify(attachmentStorage).delete(documentId + "/" + response.id());
    }

    @Test
    void upload_commitAfterFlush_keepsStoredFile() {
        stubStoragePut();
        when(permissionService.requireEditAccess(userId, documentId)).thenReturn(document);
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(attachmentRepository.saveAndFlush(any(Attachment.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        List<TransactionSynchronization> synchronizations;
        TransactionSynchronizationManager.initSynchronization();
        try {
            attachmentService.upload(userId, documentId, multipartFile("a.png", "image/png", "data"));
            synchronizations = TransactionSynchronizationManager.getSynchronizations();
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }

        assertThat(synchronizations).hasSize(1);
        synchronizations.get(0).afterCompletion(TransactionSynchronization.STATUS_COMMITTED);

        verify(attachmentStorage, never()).delete(anyString());
    }

    // --- signed URL issuance --------------------------------------------------

    @Test
    void resolveUrl_viewer_returnsSignedUrl() {
        Attachment attachment = attachment();
        when(attachmentRepository.findById(attachment.getId())).thenReturn(Optional.of(attachment));
        when(permissionService.resolveAccess(userId, documentId)).thenReturn(DocumentAccessLevel.VIEW);

        AttachmentUrlResponse response = attachmentService.resolveUrl(userId, attachment.getId());

        assertThat(response.url()).startsWith("/api/v1/attachments/" + attachment.getId() + "/file?exp=");
        assertThat(response.url()).contains("&sig=");
        assertThat(response.expiresAt()).isAfter(Instant.now());
    }

    @Test
    void resolveUrl_anonymousViewerOfPublicDocument_returnsSignedUrl() {
        Attachment attachment = attachment();
        when(attachmentRepository.findById(attachment.getId())).thenReturn(Optional.of(attachment));
        when(permissionService.resolvePublicAccess(documentId)).thenReturn(DocumentAccessLevel.VIEW);

        AttachmentUrlResponse response = attachmentService.resolveUrl(null, attachment.getId());

        assertThat(response.url()).startsWith("/api/v1/attachments/" + attachment.getId() + "/file?exp=");
    }

    @Test
    void resolveUrl_anonymousViewerOfInheritedPublicDocument_returnsSignedUrl() {
        // The owning document stays RESTRICTED; the effective grant comes from an
        // ANYONE_WITH_LINK ancestor via resolve_public_access.
        document.setGeneralAccessMode(DocumentGeneralAccessMode.RESTRICTED);
        Attachment attachment = attachment();
        when(attachmentRepository.findById(attachment.getId())).thenReturn(Optional.of(attachment));
        when(permissionService.resolvePublicAccess(documentId)).thenReturn(DocumentAccessLevel.VIEW);

        AttachmentUrlResponse response = attachmentService.resolveUrl(null, attachment.getId());

        assertThat(response.url()).startsWith("/api/v1/attachments/" + attachment.getId() + "/file?exp=");
    }

    @Test
    void resolveUrl_anonymousViewerOfRestrictedDocument_throwsNotFound() {
        Attachment attachment = attachment();
        when(attachmentRepository.findById(attachment.getId())).thenReturn(Optional.of(attachment));
        when(permissionService.resolvePublicAccess(documentId)).thenReturn(null);

        assertApiError(ErrorCode.NOT_FOUND, () -> attachmentService.resolveUrl(null, attachment.getId()));
    }

    @Test
    void resolveUrl_callerWithoutDocumentAccess_throwsNotFound() {
        Attachment attachment = attachment();
        when(attachmentRepository.findById(attachment.getId())).thenReturn(Optional.of(attachment));
        when(permissionService.resolveAccess(userId, documentId)).thenReturn(null);

        assertApiError(ErrorCode.NOT_FOUND, () -> attachmentService.resolveUrl(userId, attachment.getId()));
    }

    @Test
    void resolveUrl_trashedDocument_usesTrashAccess() {
        document.setDeletedAt(OffsetDateTime.now());
        Attachment attachment = attachment();
        when(attachmentRepository.findById(attachment.getId())).thenReturn(Optional.of(attachment));
        when(permissionService.resolveTrashAccess(userId, documentId)).thenReturn(DocumentAccessLevel.EDIT);

        AttachmentUrlResponse response = attachmentService.resolveUrl(userId, attachment.getId());

        assertThat(response.url()).isNotBlank();
    }

    @Test
    void resolveUrl_anonymousViewerOfTrashedDocument_throwsNotFound() {
        document.setDeletedAt(OffsetDateTime.now());
        Attachment attachment = attachment();
        when(attachmentRepository.findById(attachment.getId())).thenReturn(Optional.of(attachment));

        assertApiError(ErrorCode.NOT_FOUND, () -> attachmentService.resolveUrl(null, attachment.getId()));
    }

    @Test
    void resolveUrl_trashedDocumentWithoutTrashAccess_throwsNotFound() {
        document.setDeletedAt(OffsetDateTime.now());
        Attachment attachment = attachment();
        when(attachmentRepository.findById(attachment.getId())).thenReturn(Optional.of(attachment));
        when(permissionService.resolveTrashAccess(userId, documentId)).thenReturn(null);

        assertApiError(ErrorCode.NOT_FOUND, () -> attachmentService.resolveUrl(userId, attachment.getId()));
    }

    @Test
    void resolveUrl_unknownAttachment_throwsNotFound() {
        UUID attachmentId = UUID.randomUUID();
        when(attachmentRepository.findById(attachmentId)).thenReturn(Optional.empty());

        assertApiError(ErrorCode.NOT_FOUND, () -> attachmentService.resolveUrl(userId, attachmentId));
    }

    @Test
    void resolveUrl_withPublicBaseUrl_prefixesSignedUrl() {
        properties.setPublicBaseUrl("https://files.example.com/");
        attachmentService.normalizePublicBaseUrl();
        Attachment attachment = attachment();
        when(attachmentRepository.findById(attachment.getId())).thenReturn(Optional.of(attachment));
        when(permissionService.resolveAccess(userId, documentId)).thenReturn(DocumentAccessLevel.EDIT);

        AttachmentUrlResponse response = attachmentService.resolveUrl(userId, attachment.getId());

        assertThat(response.url()).startsWith("https://files.example.com/api/v1/attachments/");
    }

    // --- download -------------------------------------------------------------

    @Test
    void load_validSignature_returnsStoredFile() {
        Attachment attachment = attachment();
        when(attachmentRepository.findById(attachment.getId())).thenReturn(Optional.of(attachment));
        when(attachmentStorage.open(attachment.getStorageKey()))
                .thenReturn(
                        new StoredAttachment(new ByteArrayResource("hello".getBytes(StandardCharsets.UTF_8)), 5, true));

        AttachmentSigner.SignedUrl signed = signer.sign(attachment.getId());
        AttachmentService.AttachmentDownload download =
                attachmentService.load(attachment.getId(), signed.expiresAt(), signed.signature());

        assertThat(download.stored().sizeBytes()).isEqualTo(5);
    }

    @Test
    void load_expiredSignature_throwsNotFound() {
        Attachment attachment = attachment();
        AttachmentProperties expiredProperties = new AttachmentProperties();
        expiredProperties.setSigningSecret(SIGNING_SECRET);
        expiredProperties.setUrlTtl(Duration.ofSeconds(-5));
        AttachmentSigner.SignedUrl expired =
                new AttachmentSigner(expiredProperties, SIGNING_SECRET).sign(attachment.getId());

        assertApiError(
                ErrorCode.NOT_FOUND,
                () -> attachmentService.load(attachment.getId(), expired.expiresAt(), expired.signature()));
    }

    @Test
    void load_urlMintedBeforeRevocation_stillServesUntilExpiry() {
        // Documented capability model: the download trusts the signature alone because media
        // tags cannot authenticate, so revocation lands through /url re-minting and the URL
        // TTL. Pinned here so changing that policy has to be explicit.
        document.setDeletedAt(OffsetDateTime.now());
        Attachment attachment = attachment();
        when(attachmentRepository.findById(attachment.getId())).thenReturn(Optional.of(attachment));
        when(attachmentStorage.open(attachment.getStorageKey()))
                .thenReturn(
                        new StoredAttachment(new ByteArrayResource("hello".getBytes(StandardCharsets.UTF_8)), 5, true));

        AttachmentSigner.SignedUrl signed = signer.sign(attachment.getId());
        AttachmentService.AttachmentDownload download =
                attachmentService.load(attachment.getId(), signed.expiresAt(), signed.signature());

        assertThat(download.attachment().getId()).isEqualTo(attachment.getId());
        // Minting a fresh URL, by contrast, still re-checks: a trashed document needs trash
        // access, so a revoked viewer cannot obtain a new URL after revocation.
        when(permissionService.resolveTrashAccess(userId, documentId)).thenReturn(null);
        assertApiError(ErrorCode.NOT_FOUND, () -> attachmentService.resolveUrl(userId, attachment.getId()));
    }

    @Test
    void load_tamperedSignature_throwsNotFound() {
        Attachment attachment = attachment();
        AttachmentSigner.SignedUrl signed = signer.sign(attachment.getId());

        assertApiError(
                ErrorCode.NOT_FOUND, () -> attachmentService.load(attachment.getId(), signed.expiresAt(), "tampered"));

        verifyNoInteractions(attachmentStorage);
    }

    @Test
    void load_unknownAttachment_throwsNotFound() {
        UUID attachmentId = UUID.randomUUID();
        AttachmentSigner.SignedUrl signed = signer.sign(attachmentId);
        when(attachmentRepository.findById(attachmentId)).thenReturn(Optional.empty());

        assertApiError(
                ErrorCode.NOT_FOUND,
                () -> attachmentService.load(attachmentId, signed.expiresAt(), signed.signature()));
    }

    @Test
    void load_rowExistsButFileMissingFromDisk_throwsNotFound() {
        // The orphan case the feature can produce: metadata survives but the bytes are
        // gone, so the download must surface a 404 rather than an IOException.
        Attachment attachment = attachment();
        when(attachmentRepository.findById(attachment.getId())).thenReturn(Optional.of(attachment));
        when(attachmentStorage.open(attachment.getStorageKey())).thenThrow(new ApiException(ErrorCode.NOT_FOUND));

        AttachmentSigner.SignedUrl signed = signer.sign(attachment.getId());

        assertApiError(
                ErrorCode.NOT_FOUND,
                () -> attachmentService.load(attachment.getId(), signed.expiresAt(), signed.signature()));
    }

    // --- cleanup --------------------------------------------------------------

    @Test
    void deleteStoredFilesAfterCommit_withoutActiveTransaction_deletesImmediately() {
        attachmentService.deleteStoredFilesAfterCommit(List.of("doc/file"));

        verify(attachmentStorage).delete("doc/file");
    }

    @Test
    void deleteStoredFilesAfterCommit_withActiveTransaction_defersUntilCommit() {
        List<TransactionSynchronization> synchronizations;
        TransactionSynchronizationManager.initSynchronization();
        try {
            attachmentService.deleteStoredFilesAfterCommit(List.of("doc/file"));
            // The file must survive until commit, or a rollback would lose a live attachment.
            verify(attachmentStorage, never()).delete(anyString());
            synchronizations = TransactionSynchronizationManager.getSynchronizations();
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }

        assertThat(synchronizations).hasSize(1);
        synchronizations.get(0).afterCommit();

        verify(attachmentStorage).delete("doc/file");
    }

    @Test
    void deleteStoredFilesAfterCommit_withoutKeys_doesNothing() {
        attachmentService.deleteStoredFilesAfterCommit(List.of());

        verifyNoInteractions(attachmentStorage);
    }

    @Test
    void deleteStoredFilesAfterCommit_singleKeyFailure_deletesRemainingKeys() {
        doThrow(new RuntimeException("disk gone")).when(attachmentStorage).delete("bad");
        attachmentService.deleteStoredFilesAfterCommit(List.of("bad", "good"));

        // Per-key try/catch: one failed delete must not swallow the rest.
        verify(attachmentStorage).delete("bad");
        verify(attachmentStorage).delete("good");
    }

    @Test
    void deleteForDocuments_withoutDocuments_returnsZero() {
        assertEquals(0, attachmentService.deleteForDocuments(List.of()));

        verifyNoInteractions(attachmentRepository);
    }

    @Test
    void deleteForDocuments_delegatesNonEmptyIdsToTheRepository() {
        when(attachmentRepository.deleteByDocumentIds(List.of(documentId))).thenReturn(2);

        assertEquals(2, attachmentService.deleteForDocuments(List.of(documentId)));

        verify(attachmentRepository).deleteByDocumentIds(List.of(documentId));
    }

    @Test
    void deleteForDocuments_overBatchSize_deletesInBoundedQueries() {
        List<UUID> ids = new ArrayList<>();
        for (int i = 0; i < 501; i++) {
            ids.add(UUID.randomUUID());
        }
        when(attachmentRepository.deleteByDocumentIds(ids.subList(0, 500))).thenReturn(500);
        when(attachmentRepository.deleteByDocumentIds(ids.subList(500, 501))).thenReturn(1);

        assertEquals(501, attachmentService.deleteForDocuments(ids));

        // 500 + 1: collapsing to a single call would build one giant IN clause.
        verify(attachmentRepository).deleteByDocumentIds(ids.subList(0, 500));
        verify(attachmentRepository).deleteByDocumentIds(ids.subList(500, 501));
    }

    @Test
    void releaseQuotaForDocuments_delegatesToTheQuotaService() {
        attachmentService.releaseQuotaForDocuments(List.of(documentId));

        verify(quotaService).releaseForDocuments(List.of(documentId));
    }

    @Test
    void releaseQuotaForDocuments_whenQuotaServiceThrows_propagates() {
        doThrow(new RuntimeException("quota store gone")).when(quotaService).releaseForDocuments(List.of(documentId));

        assertThatThrownBy(() -> attachmentService.releaseQuotaForDocuments(List.of(documentId)))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("quota store gone");
    }

    @Test
    void findStorageKeysForDocuments_withoutDocuments_returnsEmptyWithoutQuerying() {
        assertThat(attachmentService.findStorageKeysForDocuments(null)).isEmpty();
        assertThat(attachmentService.findStorageKeysForDocuments(List.of())).isEmpty();

        verifyNoInteractions(attachmentRepository);
    }

    @Test
    void findStorageKeysForDocuments_overBatchSize_readsInBoundedQueries() {
        List<UUID> ids = new ArrayList<>();
        for (int i = 0; i < 501; i++) {
            ids.add(UUID.randomUUID());
        }
        when(attachmentRepository.findStorageKeysByDocumentIds(ids.subList(0, 500)))
                .thenReturn(List.of("doc/a"));
        when(attachmentRepository.findStorageKeysByDocumentIds(ids.subList(500, 501)))
                .thenReturn(List.of("doc/b"));

        assertThat(attachmentService.findStorageKeysForDocuments(ids)).containsExactly("doc/a", "doc/b");

        // 500 + 1: collapsing to a single call would exceed bind-parameter limits.
        verify(attachmentRepository).findStorageKeysByDocumentIds(ids.subList(0, 500));
        verify(attachmentRepository).findStorageKeysByDocumentIds(ids.subList(500, 501));
    }

    // --- helpers --------------------------------------------------------------

    private Attachment attachment() {
        return Attachment.builder()
                .id(UUID.randomUUID())
                .document(document)
                .uploadedBy(user)
                .fileName("a.png")
                .contentType("image/png")
                .sizeBytes(3)
                .storageKey(documentId + "/" + UUID.randomUUID())
                .sha256("0".repeat(64))
                .build();
    }

    private List<Attachment> captureUploads(String[] fileNames, String contentType) {
        String[] contentTypes = new String[fileNames.length];
        java.util.Arrays.fill(contentTypes, contentType);
        return captureUploads(fileNames, contentTypes);
    }

    private List<Attachment> captureUploads(String[] fileNames, String[] contentTypes) {
        stubStoragePut();
        when(permissionService.requireEditAccess(userId, documentId)).thenReturn(document);
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(attachmentRepository.saveAndFlush(any(Attachment.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));
        for (int i = 0; i < fileNames.length; i++) {
            attachmentService.upload(userId, documentId, multipartFile(fileNames[i], contentTypes[i], "data"));
        }
        ArgumentCaptor<Attachment> captor = ArgumentCaptor.forClass(Attachment.class);
        verify(attachmentRepository, times(fileNames.length)).saveAndFlush(captor.capture());
        return captor.getAllValues();
    }

    private void stubStoragePut() {
        doAnswer(invocation -> {
                    try (InputStream inputStream = invocation.getArgument(1)) {
                        inputStream.transferTo(OutputStream.nullOutputStream());
                    }
                    return null;
                })
                .when(attachmentStorage)
                .put(anyString(), any(InputStream.class));
    }

    private static MultipartFile multipartFile(String fileName, String contentType, String content) {
        MultipartFile file = mock(MultipartFile.class);
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        lenient().when(file.getOriginalFilename()).thenReturn(fileName);
        lenient().when(file.getContentType()).thenReturn(contentType);
        lenient().when(file.getSize()).thenReturn((long) bytes.length);
        lenient().when(file.isEmpty()).thenReturn(bytes.length == 0);
        try {
            lenient().when(file.getInputStream()).thenReturn(new ByteArrayInputStream(bytes));
        } catch (IOException exception) {
            throw new UncheckedIOException(exception);
        }
        return file;
    }

    /** Declares a tiny size while streaming the real bytes, modeling a container that lies. */
    private static MultipartFile underReportingMultipartFile(String fileName, String contentType, String content) {
        MultipartFile file = multipartFile(fileName, contentType, content);
        lenient().when(file.getSize()).thenReturn(1L);
        return file;
    }

    private static void assertApiError(ErrorCode expected, Runnable action) {
        assertThatThrownBy(action::run)
                .isInstanceOf(ApiException.class)
                .extracting(exception -> ((ApiException) exception).getErrorCode())
                .isEqualTo(expected);
    }
}
