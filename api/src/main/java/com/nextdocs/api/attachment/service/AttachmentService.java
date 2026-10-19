package com.nextdocs.api.attachment.service;

import com.nextdocs.api.attachment.AttachmentContentTypes;
import com.nextdocs.api.attachment.AttachmentScope;
import com.nextdocs.api.attachment.AttachmentVisibility;
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
import jakarta.annotation.PostConstruct;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.PushbackInputStream;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

/**
 * Owns the attachment lifecycle: store on upload, hand out short-lived signed URLs (read
 * access required, or ANYONE_WITH_LINK for anonymous viewers), and clean up files when the
 * owning document is permanently removed or a workspace icon is replaced. Which scope an
 * attachment belongs to changes the authorization (one {@link AttachmentAccessPolicy}),
 * the foreign key it is bound to (one {@link AttachmentScopeBinder}), and whether the
 * upload must be a raster image (workspace uploads can only become the icon); storage,
 * quota, hashing, and signing stay scope-blind.
 *
 * <p>Blocks store the host-independent path {@code /api/v1/attachments/{id}} — never an absolute
 * or signed URL — so documents stay portable between self-hosted deployments and no perishable
 * capability is written into permanent Yjs history.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AttachmentService {

    private static final int QUERY_BATCH_SIZE = 500;
    private static final String DEFAULT_CONTENT_TYPE = "application/octet-stream";
    private static final int MAX_FILE_NAME_LENGTH = 255;
    private static final int MAX_CONTENT_TYPE_LENGTH = 255;
    private static final String SAFE_CONTENT_TYPE_PATTERN = "[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+";

    private final AttachmentRepository attachmentRepository;
    private final UserRepository userRepository;
    private final AttachmentAccessPolicy accessPolicy;
    private final AttachmentScopeBinder scopeBinder;
    private final AttachmentStorage attachmentStorage;
    private final AttachmentSigner attachmentSigner;
    private final AttachmentQuotaService quotaService;
    private final AttachmentProperties attachmentProperties;
    private final AttachmentMetadataWriter attachmentMetadataWriter;

    /** Normalized once so per-request URL building is a plain prefix concatenation. */
    private String normalizedPublicBaseUrl;

    @PostConstruct
    void normalizePublicBaseUrl() {
        String baseUrl = attachmentProperties.getPublicBaseUrl();
        normalizedPublicBaseUrl = StringUtils.hasText(baseUrl) ? baseUrl.strip().replaceAll("/+$", "") : null;
    }

    /**
     * Stores an uploaded file and its metadata.
     *
     * <p>Deliberately <b>not</b> transactional: the disk write can take seconds for a
     * multi-megabyte file, and holding a pooled connection for it starves the rest of the
     * API. The quota reservation and the metadata insert are each their own short
     * transaction, and any failure between them reclaims both the file and the reservation.
     */
    public AttachmentResponse upload(UUID userId, AttachmentScope scope, MultipartFile file) {
        accessPolicy.requireUpload(userId, scope);
        return uploadAuthorized(userId, scope, file);
    }

    /**
     * Stores an upload under the caller's own workspace. Owner only; the workspace is
     * resolved once here instead of by every caller before the upload.
     */
    public AttachmentResponse uploadWorkspaceAttachment(UUID userId, MultipartFile file) {
        UUID workspaceId = accessPolicy.requireWorkspaceUpload(userId);
        return uploadAuthorized(userId, AttachmentScope.workspace(workspaceId), file);
    }

    private AttachmentResponse uploadAuthorized(UUID userId, AttachmentScope scope, MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "The uploaded file must not be empty.");
        }
        long maxFileSizeBytes = attachmentProperties.getMaxFileSize().toBytes();
        // MultipartFile.getSize() is advisory and can be -1 when unknown; clamping keeps a
        // hypothetical unknown length from poisoning the reservation math below.
        long declaredSize = Math.max(0, file.getSize());
        if (declaredSize > maxFileSizeBytes) {
            throw new ApiException(ErrorCode.PAYLOAD_TOO_LARGE, describeSizeLimit(maxFileSizeBytes));
        }

        String sanitizedDeclaredType = sanitizeContentType(file.getContentType());
        // One open of the multipart stream feeds both the sniff and the store: a
        // MultipartFile is not required to hand out a fresh stream per
        // getInputStream() call, so sniffing and storing from two calls could hash
        // one payload and persist another — or read a stream already at EOF.
        ProbedUpload probe = openForSniff(file);

        PushbackInputStream upload = probe.stream();
        try {
            // Sniff the actual bytes to detect raster images and reject spoofed raster
            // labels. Runs before the quota reservation so spoofed uploads never churn
            // quota.
            String resolvedContentType = resolveContentType(sanitizedDeclaredType, probe.head());
            // The only workspace upload is the icon, and adoption re-sniffs the bytes.
            // Rejecting here too keeps an abandoned PDF/ZIP out of storage and quota.
            if (scope.kind() == AttachmentScope.Kind.WORKSPACE
                    && !AttachmentContentTypes.INLINE_RASTER_IMAGE_TYPES.contains(resolvedContentType)) {
                throw new ApiException(ErrorCode.VALIDATION_FAILED, AttachmentContentTypes.UNSUPPORTED_RASTER_MESSAGE);
            }

            User uploader = userRepository.findById(userId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));

            UUID attachmentId = UUID.randomUUID();
            String storageKey = scope.id() + "/" + attachmentId;

            // Reserve before touching the disk so an over-quota upload leaves nothing behind,
            // and before the write so the reservation is committed by its own short transaction.
            quotaService.reserve(userId, declaredSize);
            long reservedBytes = declaredSize;

            try {
                StoredContent stored = storeAndHash(storageKey, upload);

                // The multipart container's declared size is advisory and can be wrong, so the
                // limit is re-checked against the bytes actually read.
                if (stored.sizeBytes() > maxFileSizeBytes) {
                    throw new ApiException(ErrorCode.PAYLOAD_TOO_LARGE, describeSizeLimit(maxFileSizeBytes));
                }
                if (stored.sizeBytes() != reservedBytes) {
                    adjustReservation(userId, reservedBytes, stored.sizeBytes());
                    reservedBytes = stored.sizeBytes();
                }

                Attachment.AttachmentBuilder builder = Attachment.builder()
                        .id(attachmentId)
                        .uploadedBy(uploader)
                        .fileName(sanitizeFileName(file.getOriginalFilename()))
                        .contentType(resolvedContentType)
                        .sizeBytes(stored.sizeBytes())
                        .storageKey(storageKey)
                        .sha256(stored.sha256());
                Attachment saved = attachmentMetadataWriter.insert(
                        scopeBinder.bind(builder, scope).build());
                return toResponse(saved);
            } catch (RuntimeException ex) {
                // Never leave bytes on disk that no database row points at, and never hold
                // reserved quota for an upload that did not happen. Cleanup is best effort and
                // must not replace the original failure with whatever it throws.
                try {
                    attachmentStorage.delete(storageKey);
                } catch (RuntimeException cleanupFailure) {
                    log.warn(
                            "Failed to delete stored file {} after a failed upload: {}",
                            storageKey,
                            cleanupFailure.getMessage());
                }
                try {
                    quotaService.release(userId, reservedBytes);
                } catch (RuntimeException cleanupFailure) {
                    log.warn(
                            "Failed to release {} reserved bytes for user {}: {}",
                            reservedBytes,
                            userId,
                            cleanupFailure.getMessage());
                }
                throw ex;
            }
        } finally {
            // try-with-resources would have to declare IOException for close(); a close
            // failure on an already-read stream is not worth failing a stored upload over.
            closeUploadStream(upload);
        }
    }

    private static void closeUploadStream(InputStream upload) {
        try {
            upload.close();
        } catch (IOException ex) {
            log.debug("Failed to close the upload stream: {}", ex.getMessage());
        }
    }

    /**
     * Opens the upload stream once and reads the bytes the sniff needs, pushing them
     * back so the store still sees the whole payload.
     */
    private static ProbedUpload openForSniff(MultipartFile file) {
        try {
            PushbackInputStream stream =
                    new PushbackInputStream(file.getInputStream(), AttachmentContentTypes.SNIFF_BYTES);
            byte[] head = stream.readNBytes(AttachmentContentTypes.SNIFF_BYTES);
            stream.unread(head);
            return new ProbedUpload(stream, head);
        } catch (IOException ex) {
            throw new ApiException(ErrorCode.INTERNAL_ERROR, "Failed to read the uploaded file.");
        }
    }

    /**
     * The bytes win over the label: a detected raster image is stored as its detected type,
     * a raster label over non-raster bytes is rejected outright, and anything else keeps the
     * sanitized label so non-image attachments still round-trip.
     */
    private static String resolveContentType(String declaredType, byte[] head) {
        String detected = AttachmentContentTypes.detectRasterImageType(head);
        if (detected != null) {
            return detected;
        }
        if (AttachmentContentTypes.INLINE_RASTER_IMAGE_TYPES.contains(declaredType)) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, AttachmentContentTypes.UNSUPPORTED_RASTER_MESSAGE);
        }
        return declaredType;
    }

    /**
     * Moves the reservation to the bytes actually stored. A container that under-reports
     * its size must not get a quota discount for the difference.
     */
    private void adjustReservation(UUID userId, long reservedBytes, long actualBytes) {
        long delta = actualBytes - reservedBytes;
        if (delta > 0) {
            quotaService.reserve(userId, delta);
        } else if (delta < 0) {
            quotaService.release(userId, -delta);
        }
    }

    /**
     * Issues a signed download URL for an attachment the caller may read.
     *
     * @param userId caller id, or {@code null} for anonymous viewers (shared documents and
     *     public workspace branding only)
     */
    @Transactional(readOnly = true)
    public AttachmentUrlResponse resolveUrl(UUID userId, UUID attachmentId) {
        Attachment attachment =
                attachmentRepository.findById(attachmentId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));

        accessPolicy.requireDownload(userId, attachment);

        AttachmentSigner.SignedUrl signedUrl = attachmentSigner.sign(attachmentId);
        return new AttachmentUrlResponse(
                buildDownloadUrl(attachmentId, signedUrl), Instant.ofEpochSecond(signedUrl.expiresAt()));
    }

    /**
     * Verifies a signed URL and opens the stored file. Signature possession is the entire
     * capability check here, which is what lets plain {@code <img>}/{@code <video>} tags work.
     *
     * <p>The consequence is deliberate and pinned by test: a URL minted before a share is
     * revoked (or a collaborator removed, or a document trashed) keeps serving until it
     * expires. Revocation takes effect through {@link #resolveUrl}, which re-runs the
     * permission check whenever the editor re-mints on render, so the window is bounded by
     * the configured URL TTL rather than being instantaneous.
     */
    @Transactional(readOnly = true)
    public AttachmentDownload load(UUID attachmentId, long expiresAt, String signature) {
        attachmentSigner.verify(attachmentId, expiresAt, signature);

        Attachment attachment =
                attachmentRepository.findById(attachmentId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
        StoredAttachment stored = attachmentStorage.open(attachment.getStorageKey());
        return new AttachmentDownload(attachment, stored);
    }

    @Transactional(readOnly = true)
    public List<String> findStorageKeysForDocuments(Collection<UUID> documentIds) {
        if (documentIds == null || documentIds.isEmpty()) {
            return List.of();
        }
        List<UUID> ids = List.copyOf(documentIds);
        List<String> storageKeys = new ArrayList<>(ids.size());
        for (int start = 0; start < ids.size(); start += QUERY_BATCH_SIZE) {
            storageKeys.addAll(attachmentRepository.findStorageKeysByDocumentIds(batch(ids, start)));
        }
        return storageKeys;
    }

    /** Frees the storage quota held by the attachments of the given documents. */
    @Transactional
    public void releaseQuotaForDocuments(Collection<UUID> documentIds) {
        quotaService.releaseForDocuments(documentIds);
    }

    /**
     * Workspace-scoped uploads created before {@code cutoff}. The abandoned-icon sweep
     * keeps the one the workspace's icon references and deletes the rest.
     */
    @Transactional(readOnly = true)
    public List<Attachment> findWorkspaceUploadsCreatedBefore(OffsetDateTime cutoff) {
        return attachmentRepository.findByWorkspaceIsNotNullAndCreatedAtBefore(cutoff);
    }

    /**
     * Makes a workspace upload anonymously readable. Called when the workspace icon adopts
     * it: an upload nobody applied is an unfinished edit and stays private, so a guessed id
     * cannot read an abandoned file before the sweep deletes it. A missing row or one
     * outside {@code workspaceId} is a no-op, like {@link #deleteWorkspaceUpload}.
     */
    @Transactional
    public void publishWorkspaceUpload(UUID workspaceId, UUID attachmentId) {
        Attachment attachment = findWorkspaceUpload(workspaceId, attachmentId);
        if (attachment == null) {
            return;
        }
        attachment.setVisibility(AttachmentVisibility.PUBLIC);
    }

    /**
     * Deletes a workspace-scoped upload and hands its bytes back to the uploader's quota.
     *
     * <p>Workspaces have no purge path like documents do, so replacing or clearing a
     * workspace icon has to clean up after itself here. A missing row is a no-op, and a
     * row outside {@code workspaceId} is left alone: callers must not be able to name a
     * file into or out of a workspace they are not cleaning up.
     */
    @Transactional
    public void deleteWorkspaceUpload(UUID workspaceId, UUID attachmentId) {
        Attachment attachment = findWorkspaceUpload(workspaceId, attachmentId);
        if (attachment == null) {
            return;
        }
        attachmentRepository.delete(attachment);
        quotaService.release(attachment.getUploadedBy().getId(), attachment.getSizeBytes());
        deleteStoredFilesAfterCommit(List.of(attachment.getStorageKey()));
    }

    /** The row only when it is workspace-scoped and belongs to {@code workspaceId}. */
    private Attachment findWorkspaceUpload(UUID workspaceId, UUID attachmentId) {
        Attachment attachment = attachmentRepository.findById(attachmentId).orElse(null);
        if (attachment == null
                || attachment.getWorkspace() == null
                || !attachment.getWorkspace().getId().equals(workspaceId)) {
            return null;
        }
        return attachment;
    }

    @Transactional
    public int deleteForDocuments(Collection<UUID> documentIds) {
        if (documentIds == null || documentIds.isEmpty()) {
            return 0;
        }
        List<UUID> ids = List.copyOf(documentIds);
        int deleted = 0;
        for (int start = 0; start < ids.size(); start += QUERY_BATCH_SIZE) {
            deleted += attachmentRepository.deleteByDocumentIds(batch(ids, start));
        }
        return deleted;
    }

    /**
     * Splits id lists so one giant subtree cannot exceed the database's bind-parameter
     * limit or build an unreasonably large IN clause.
     */
    private static List<UUID> batch(List<UUID> ids, int start) {
        return ids.subList(start, Math.min(start + QUERY_BATCH_SIZE, ids.size()));
    }

    /**
     * Deletes stored bytes once the current transaction commits, so a rollback can never lose
     * files that still have database rows. Deletion is best effort: an orphaned file wastes
     * disk but is harmless, whereas a missing file for a live row breaks the document.
     */
    public void deleteStoredFilesAfterCommit(Collection<String> storageKeys) {
        if (storageKeys == null || storageKeys.isEmpty()) {
            return;
        }
        List<String> keys = List.copyOf(storageKeys);
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    deleteStoredFiles(keys);
                }
            });
            return;
        }
        deleteStoredFiles(keys);
    }

    /**
     * Streams the upload to storage while hashing it and counting what was actually read.
     * The persisted size must match the bytes on disk, not the multipart container's claim.
     * Takes the already-open upload stream so one payload is both sniffed and stored.
     */
    private StoredContent storeAndHash(String storageKey, InputStream inputStream) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            CountingInputStream countingStream = new CountingInputStream(inputStream);
            try (DigestInputStream digestStream = new DigestInputStream(countingStream, digest)) {
                attachmentStorage.put(storageKey, digestStream);
            }
            return new StoredContent(HexFormat.of().formatHex(digest.digest()), countingStream.getCount());
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is unavailable in this JVM.", ex);
        } catch (IOException ex) {
            throw new ApiException(ErrorCode.INTERNAL_ERROR, "Failed to read the uploaded file.");
        }
    }

    private void deleteStoredFiles(Collection<String> storageKeys) {
        for (String storageKey : storageKeys) {
            try {
                attachmentStorage.delete(storageKey);
            } catch (RuntimeException ex) {
                log.warn("Failed to delete stored attachment {}: {}", storageKey, ex.getMessage());
            }
        }
    }

    /**
     * Builds the signed download path, optionally prefixed with {@code public-base-url} so a
     * self-hoster can serve files from a separate host or CDN.
     */
    private String buildDownloadUrl(UUID attachmentId, AttachmentSigner.SignedUrl signedUrl) {
        String relativeUrl = "/api/v1/attachments/" + attachmentId + "/file?exp=" + signedUrl.expiresAt() + "&sig="
                + signedUrl.signature();
        return normalizedPublicBaseUrl == null ? relativeUrl : normalizedPublicBaseUrl + relativeUrl;
    }

    private static String describeSizeLimit(long maxFileSizeBytes) {
        return String.format(
                Locale.ROOT, "File exceeds the maximum allowed size of %.1f MB.", maxFileSizeBytes / (1024.0 * 1024.0));
    }

    private static String sanitizeFileName(String originalFileName) {
        String cleaned = StringUtils.cleanPath(originalFileName == null ? "" : originalFileName)
                .replace('\\', '/');
        int lastSlash = cleaned.lastIndexOf('/');
        if (lastSlash >= 0) {
            cleaned = cleaned.substring(lastSlash + 1);
        }
        cleaned = cleaned.replaceAll("\\p{Cntrl}", "").strip();
        if (cleaned.isBlank() || cleaned.equals(".") || cleaned.equals("..")) {
            return "file";
        }
        return truncateToCodePoints(cleaned, MAX_FILE_NAME_LENGTH);
    }

    /**
     * Truncates on a code-point boundary so a multi-byte character (an emoji, an accented
     * letter) is never split into a lone surrogate, which some clients render as U+FFFD.
     */
    private static String truncateToCodePoints(String value, int maxCodePoints) {
        if (value.codePointCount(0, value.length()) <= maxCodePoints) {
            return value;
        }
        return value.substring(0, value.offsetByCodePoints(0, maxCodePoints));
    }

    private static String sanitizeContentType(String contentType) {
        if (!StringUtils.hasText(contentType)) {
            return DEFAULT_CONTENT_TYPE;
        }
        String value = contentType.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        if (value.length() > MAX_CONTENT_TYPE_LENGTH || !value.matches(SAFE_CONTENT_TYPE_PATTERN)) {
            return DEFAULT_CONTENT_TYPE;
        }
        return value;
    }

    private AttachmentResponse toResponse(Attachment attachment) {
        return new AttachmentResponse(
                attachment.getId(),
                attachment.getDocument() == null
                        ? null
                        : attachment.getDocument().getId(),
                attachment.getFileName(),
                attachment.getContentType(),
                attachment.getSizeBytes(),
                "/api/v1/attachments/" + attachment.getId(),
                attachment.getCreatedAt());
    }

    /** Bytes actually copied to storage plus their digest. */
    private record StoredContent(String sha256, long sizeBytes) {}

    /** The opened upload stream plus the head already read from it. */
    private record ProbedUpload(PushbackInputStream stream, byte[] head) {}

    /**
     * Counts what the storage implementation actually read from the upload stream. Skips are
     * deliberately not counted: {@code skip} advances the underlying stream without feeding the
     * digest, so including it would let the persisted size drift from the hashed bytes.
     */
    private static final class CountingInputStream extends FilterInputStream {

        private long count;

        private CountingInputStream(InputStream in) {
            super(in);
        }

        @Override
        public int read() throws IOException {
            int value = super.read();
            if (value != -1) {
                count++;
            }
            return value;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            int read = super.read(buffer, offset, length);
            if (read > 0) {
                count += read;
            }
            return read;
        }

        long getCount() {
            return count;
        }
    }

    /** Attachment row plus the opened stored file. */
    public record AttachmentDownload(Attachment attachment, StoredAttachment stored) {}
}
