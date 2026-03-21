package com.nextdocs.api.document.dto.request;

import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.entity.DocumentGeneralAccessMode;
import com.nextdocs.api.document.validation.ValidSharingSettings;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

@Schema(description = "Update document general sharing settings")
@ValidSharingSettings
public record SharingSettingsUpdateRequest(
        @Schema(description = "General access mode", example = "ANYONE_WITH_LINK")
        @NotNull(message = "generalAccessMode is required")
        DocumentGeneralAccessMode generalAccessMode,

        @Schema(description = "Default access level for anyone-with-link mode", example = "VIEW")
        DocumentAccessLevel linkAccessLevel) {}
