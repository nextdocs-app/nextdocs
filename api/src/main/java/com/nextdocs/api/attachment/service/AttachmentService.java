package com.nextdocs.api.attachment.service;

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
import com.nextdocs.api.document.service.PermissionService;
import jakarta.annotation.PostConstruct;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
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
 * Owns the attachment lifecycle: store on upload (EDIT access required), hand out short-lived
 * signed URLs (read access required, or ANYONE_WITH_LINK for anonymous viewers), and clean up
 * files when documents are permanently removed.
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
    private final PermissionService permissionService;
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
    public AttachmentResponse upload(UUID userId, UUID documentId, MultipartFile file) {
        Document document = permissionService.requireEditAccess(userId, documentId);

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

        User uploader = userRepository.findById(userId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));

        UUID attachmentId = UUID.randomUUID();
        String storageKey = document.getId() + "/" + attachmentId;

        // Reserve before touching the disk so an over-quota upload leaves nothing behind,
        // and before the write so the reservation is committed by its own short transaction.
        quotaService.reserve(userId, declaredSize);
        long reservedBytes = declaredSize;

        try {
            StoredContent stored = storeAndHash(storageKey, file);

            // The multipart container's declared size is advisory and can be wrong, so the
            // limit is re-checked against the bytes actually read.
            if (stored.sizeBytes() > maxFileSizeBytes) {
                throw new ApiException(ErrorCode.PAYLOAD_TOO_LARGE, describeSizeLimit(maxFileSizeBytes));
            }
            if (stored.sizeBytes() != reservedBytes) {
                adjustReservation(userId, reservedBytes, stored.sizeBytes());
                reservedBytes = stored.sizeBytes();
            }

            Attachment attachment = Attachment.builder()
                    .id(attachmentId)
                    .document(document)
                    .uploadedBy(uploader)
                    .fileName(sanitizeFileName(file.getOriginalFilename()))
                    .contentType(sanitizeContentType(file.getContentType()))
                    .sizeBytes(stored.sizeBytes())
                    .storageKey(storageKey)
                    .sha256(stored.sha256())
                    .build();

            Attachment saved = attachmentMetadataWriter.insert(attachment);
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
     * @param userId caller id, or {@code null} for anonymous viewers (public documents only)
     */
    @Transactional(readOnly = true)
    public AttachmentUrlResponse resolveUrl(UUID userId, UUID attachmentId) {
        Attachment attachment =
                attachmentRepository.findById(attachmentId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));

        requireDownloadPermission(userId, attachment.getDocument());

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

    private void requireDownloadPermission(UUID userId, Document document) {
        if (document.getDeletedAt() != null) {
            // Trashed documents stay readable (read-only) only for callers in the trash access
            // chain; anonymous viewers never see them, matching GET /documents/{id}.
            if (userId == null || permissionService.resolveTrashAccess(userId, document.getId()) == null) {
                throw new ApiException(ErrorCode.NOT_FOUND);
            }
            return;
        }
        if (userId == null) {
            // Anonymous viewers resolve through the effective (possibly inherited) share-link
            // grant, matching GET /documents/{id}/public and access-check. Checking only the
            // owning document's own generalAccessMode would 404 attachments on children of a
            // shared folder.
            if (permissionService.resolvePublicAccess(document.getId()) == null) {
                throw new ApiException(ErrorCode.NOT_FOUND);
            }
            return;
        }
        if (permissionService.resolveAccess(userId, document.getId()) == null) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
    }

    /**
     * Streams the upload to storage while hashing it and counting what was actually read.
     * The persisted size must match the bytes on disk, not the multipart container's claim.
     */
    private StoredContent storeAndHash(String storageKey, MultipartFile file) {
        try (InputStream inputStream = file.getInputStream()) {
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
                attachment.getDocument().getId(),
                attachment.getFileName(),
                attachment.getContentType(),
                attachment.getSizeBytes(),
                "/api/v1/attachments/" + attachment.getId(),
                attachment.getCreatedAt());
    }

    /** Bytes actually copied to storage plus their digest. */
    private record StoredContent(String sha256, long sizeBytes) {}

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
