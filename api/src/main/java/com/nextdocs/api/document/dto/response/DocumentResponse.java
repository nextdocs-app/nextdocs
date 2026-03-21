package com.nextdocs.api.document.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.OffsetDateTime;
import java.util.UUID;

@Schema(description = "Document response")
public record DocumentResponse(
        @Schema(description = "Document ID") UUID id,
        @Schema(description = "Document title") String title,

        @Schema(description = "Base64-encoded Yjs state when requested")
        String yjsState,

        @Schema(description = "Creator label") String createdBy,
        @Schema(description = "Creation timestamp") OffsetDateTime createdAt,
        @Schema(description = "Last update timestamp") OffsetDateTime updatedAt,

        @Schema(description = "When the document was moved to trash, if applicable")
        OffsetDateTime deletedAt,

        @Schema(description = "When the document will be permanently removed (trash retention)")
        OffsetDateTime purgeAt) {}
