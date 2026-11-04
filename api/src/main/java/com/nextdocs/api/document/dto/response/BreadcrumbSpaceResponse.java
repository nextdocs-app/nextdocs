package com.nextdocs.api.document.dto.response;

import com.nextdocs.api.pageicon.dto.response.PageIconResponse;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;

@Schema(description = "Space information for a document breadcrumb")
public record BreadcrumbSpaceResponse(
        @Schema(description = "Space ID") UUID id,
        @Schema(description = "Space name") String name,
        @Schema(description = "Space icon, null when none") PageIconResponse icon) {}
