package com.nextdocs.api.workspace.dto.response;

import com.nextdocs.api.workspace.entity.WorkspaceRole;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.OffsetDateTime;
import java.util.UUID;

@Schema(description = "A pending workspace invite")
public record WorkspaceInviteResponse(
        UUID id,

        @Schema(description = "Email the invite is bound to", example = "jane@example.com")
        String email,

        WorkspaceRole role,
        @Schema(description = "When the invitation lapses") OffsetDateTime expiresAt,
        OffsetDateTime createdAt) {}
