package com.nextdocs.api.space.dto.request;

import com.nextdocs.api.document.entity.DocumentAccessLevel;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

@Schema(description = "Update a space member's access level")
public record SpaceMemberAccessUpdateRequest(
        @Schema(description = "Access level in the space", example = "EDIT")
        @NotNull(message = "accessLevel is required")
        DocumentAccessLevel accessLevel) {}
