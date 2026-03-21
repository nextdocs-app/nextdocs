package com.nextdocs.api.document.dto.response;

import com.nextdocs.api.document.entity.DocumentAccessLevel;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.OffsetDateTime;
import java.util.UUID;

@Schema(description = "Collaborator entry")
public record CollaboratorResponse(
        @Schema(description = "User ID") UUID userId,
        @Schema(description = "User email") String email,
        @Schema(description = "Display name") String displayName,
        @Schema(description = "Access level") DocumentAccessLevel accessLevel,

        @Schema(description = "Collaborator grant timestamp")
        OffsetDateTime addedAt) {}
