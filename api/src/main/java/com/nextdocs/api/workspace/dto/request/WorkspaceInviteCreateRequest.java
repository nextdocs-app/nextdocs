package com.nextdocs.api.workspace.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import java.util.List;

@Schema(description = "Request body for creating invites, one per email")
public record WorkspaceInviteCreateRequest(
        @Schema(
                description = "Email addresses to invite; duplicates are collapsed and each entry gets its own result",
                example = "[\"jane@example.com\", \"john@example.com\"]")
        @NotEmpty(message = "At least one email is required")
        List<String> emails,

        @Schema(description = "Role for the invited accounts", example = "MEMBER")
        @NotBlank(message = "Role is required")
        String role) {}
