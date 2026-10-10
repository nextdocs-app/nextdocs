package com.nextdocs.api.attachment.dto.response;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * Metadata returned after an upload. {@code url} is the host-independent path stored in the
 * client's blocks and later exchanged for a signed URL via {@code /api/v1/attachments/{id}/url}.
 */
public record AttachmentResponse(
        UUID id,
        UUID documentId,
        String fileName,
        String contentType,
        long sizeBytes,
        String url,
        OffsetDateTime createdAt) {}
