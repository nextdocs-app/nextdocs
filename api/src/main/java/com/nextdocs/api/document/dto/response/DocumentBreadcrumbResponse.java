package com.nextdocs.api.document.dto.response;

import com.nextdocs.api.document.entity.DocumentAccessLevel;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.OffsetDateTime;
import java.util.UUID;

@Schema(description = "Document breadcrumb path item")
public record DocumentBreadcrumbResponse(
        @Schema(description = "Document ID") UUID id,
        @Schema(description = "Document title") String title,
        // Document icon is reserved for future icon/cover support; title is used primarily for now
        @Schema(description = "Document icon if present") String icon,

        @Schema(description = "Parent document ID, null for root-level")
        UUID parentId,

        @Schema(description = "Sibling order key") String orderKey,
        @Schema(description = "Effective access level") DocumentAccessLevel accessLevel,
        @Schema(description = "Created timestamp") OffsetDateTime createdAt,
        @Schema(description = "Updated timestamp") OffsetDateTime updatedAt) {

    public DocumentBreadcrumbResponse(UUID id, String title, String icon, UUID parentId) {
        this(id, title, icon, parentId, null, null, null, null);
    }
}
