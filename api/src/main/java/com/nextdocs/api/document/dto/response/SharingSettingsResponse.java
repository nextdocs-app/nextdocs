package com.nextdocs.api.document.dto.response;

import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.entity.DocumentGeneralAccessMode;
import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "Document sharing settings")
public record SharingSettingsResponse(
        @Schema(description = "General access mode") DocumentGeneralAccessMode generalAccessMode,

        @Schema(description = "Access level for share links")
        DocumentAccessLevel linkAccessLevel,

        @Schema(description = "Whether an active share link exists")
        boolean hasActiveLink) {}
