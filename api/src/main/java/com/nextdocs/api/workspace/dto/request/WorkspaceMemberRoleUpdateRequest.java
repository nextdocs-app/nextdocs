package com.nextdocs.api.workspace.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;

@Schema(description = "Request body for changing a member's workspace role")
public record WorkspaceMemberRoleUpdateRequest(
        @Schema(description = "New role: OWNER, ADMIN, or MEMBER (case-insensitive)", example = "ADMIN")
        @NotBlank(message = "Role is required")
        String role) {}
