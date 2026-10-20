package com.nextdocs.api.workspace.dto.response;

import com.nextdocs.api.workspace.entity.WorkspaceRole;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.OffsetDateTime;
import java.util.UUID;

@Schema(description = "Workspace member entry")
public record WorkspaceMemberResponse(
        @Schema(description = "User id") UUID userId,

        @Schema(description = "User email") String email,

        @Schema(description = "Display name") String displayName,

        @Schema(description = "Avatar URL, when set") String avatarUrl,

        @Schema(description = "Workspace role") WorkspaceRole role,

        @Schema(description = "Membership creation timestamp")
        OffsetDateTime joinedAt) {}
