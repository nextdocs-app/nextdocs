package com.nextdocs.api.attachment.service;

import com.nextdocs.api.attachment.config.AttachmentProperties;
import com.nextdocs.api.attachment.entity.AttachmentUsage;
import com.nextdocs.api.attachment.repository.AttachmentRepository;
import com.nextdocs.api.attachment.repository.AttachmentUsageRepository;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Admission control for attachment bytes: one counter per user, reserved before a file is
 * written and released when it is deleted.
 *
 * <p>The check is a short transaction that locks the user row, so two concurrent uploads
 * cannot both observe room for the same bytes (check-then-write would let anyone overshoot
 * by one file per parallel request). The counter therefore only ever moves in whole
 * operations; the worst case is a hard crash between reserve and metadata commit, which
 * leaves the counter conservative by at most one file.
 */
@Service
@RequiredArgsConstructor
public class AttachmentQuotaService {

    /** Batches the IN clauses: bounded query size, far under database bind-parameter limits. */
    static final int BATCH_SIZE = 500;

    private final UserRepository userRepository;
    private final AttachmentUsageRepository usageRepository;
    private final AttachmentRepository attachmentRepository;
    private final AttachmentProperties attachmentProperties;

    /**
     * Reserves {@code bytes} for the user, rejecting with a 413 when the limit would be
     * exceeded. Must be called before the bytes are written, so a rejected upload leaves
     * nothing on disk.
     */
    @Transactional
    public void reserve(UUID userId, long bytes) {
        if (bytes <= 0) {
            return;
        }
        AttachmentUsage usage = lockOrCreate(userId);
        long limit = attachmentProperties.maxStoragePerUserBytes();
        long next = usage.getUsedBytes() + bytes;
        // A wrapped value means the counter overflowed, which is over any real limit.
        if (next < 0 || (limit >= 0 && next > limit)) {
            throw new ApiException(ErrorCode.PAYLOAD_TOO_LARGE, describeLimit(limit));
        }
        usage.setUsedBytes(next);
        usageRepository.saveAndFlush(usage);
    }

    /**
     * Hands reserved bytes back after a failed upload or a deletion. One atomic UPDATE per
     * caller replaces the old read-modify-flush, and a missing counter row is a no-op.
     */
    @Transactional
    public void release(UUID userId, long bytes) {
        if (bytes <= 0) {
            return;
        }
        usageRepository.decrement(userId, bytes);
    }

    /**
     * Releases the bytes of every attachment of the given documents. Read before the
     * attachment rows are deleted, or the sizes are gone with them.
     */
    @Transactional
    public void releaseForDocuments(Collection<UUID> documentIds) {
        if (documentIds == null || documentIds.isEmpty()) {
            return;
        }
        List<UUID> ids = List.copyOf(documentIds);
        for (int start = 0; start < ids.size(); start += BATCH_SIZE) {
            List<UUID> batch = ids.subList(start, Math.min(start + BATCH_SIZE, ids.size()));
            for (AttachmentRepository.UploaderUsage row : attachmentRepository.sumSizeBytesByUploader(batch)) {
                long bytes = row.getTotalBytes() == null ? 0L : row.getTotalBytes();
                release(row.getUploaderId(), bytes);
            }
        }
    }

    /**
     * Locks the user row before creating the counter, so concurrent first uploads from the
     * same user cannot both insert it. The user row always exists, which makes it a safe
     * lock target; the counter row does not.
     */
    private AttachmentUsage lockOrCreate(UUID userId) {
        userRepository.findByIdForUpdate(userId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
        return usageRepository
                .findForUpdate(userId)
                .orElseGet(() ->
                        AttachmentUsage.builder().userId(userId).usedBytes(0).build());
    }

    private static String describeLimit(long limitBytes) {
        String human = limitBytes >= 1024L * 1024 * 1024
                ? String.format(Locale.ROOT, "%.1f GB", limitBytes / (1024.0 * 1024 * 1024))
                : String.format(Locale.ROOT, "%.1f MB", limitBytes / (1024.0 * 1024));
        return String.format(Locale.ROOT, "This upload would exceed your %s storage limit.", human);
    }
}
