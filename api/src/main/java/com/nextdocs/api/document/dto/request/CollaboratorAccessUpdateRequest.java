package com.nextdocs.api.document.dto.request;

import com.nextdocs.api.document.entity.DocumentAccessLevel;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

@Schema(description = "Update collaborator access level")
public record CollaboratorAccessUpdateRequest(
        @Schema(description = "Access level", example = "VIEW") @NotNull(message = "accessLevel is required")
        DocumentAccessLevel accessLevel) {}
