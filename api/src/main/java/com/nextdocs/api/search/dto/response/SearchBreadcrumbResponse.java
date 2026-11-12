package com.nextdocs.api.search.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;

@Schema(description = "Ancestor of a search hit, root first")
public record SearchBreadcrumbResponse(
        @Schema(description = "Document ID") UUID id,
        @Schema(description = "Document title") String title) {}
