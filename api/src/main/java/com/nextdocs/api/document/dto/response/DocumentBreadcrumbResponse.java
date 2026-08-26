package com.nextdocs.api.document.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;

@Schema(description = "Document breadcrumb path item")
public record DocumentBreadcrumbResponse(
        @Schema(description = "Document ID") UUID id,
        @Schema(description = "Document title") String title,
        // Document icon is reserved for future icon/cover support; title is used primarily for now
        @Schema(description = "Document icon if present") String icon,

        @Schema(description = "Parent document ID, null for root-level")
        UUID parentId) {}
