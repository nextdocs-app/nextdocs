package com.nextdocs.api.document.dto.response;

import com.nextdocs.api.document.entity.DocumentAccessLevel;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.OffsetDateTime;
import java.util.UUID;

@Schema(description = "Sidebar tree node for a document")
public record DocumentTreeNodeResponse(
        @Schema(description = "Document ID") UUID id,
        @Schema(description = "Document title") String title,

        @Schema(description = "Parent document ID, null for root-level")
        UUID parentId,

        @Schema(description = "Fractional ordering key") String orderKey,

        @Schema(description = "Whether this node has children (for lazy-load chevron)")
        boolean hasChildren,

        @Schema(description = "Effective access level of requesting user")
        DocumentAccessLevel effectiveAccessLevel,

        @Schema(description = "Creation timestamp") OffsetDateTime createdAt,
        @Schema(description = "Last update timestamp") OffsetDateTime updatedAt) {}
