package com.nextdocs.api.space.dto.request;

import com.nextdocs.api.document.entity.DocumentAccessLevel;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

@Schema(description = "Add a member to a space by email")
public record SpaceMemberCreateRequest(
        @Schema(description = "Email of an existing workspace member", example = "alice@example.com")
        @Email(message = "Email must be valid")
        @NotBlank(message = "Email is required")
        @Size(max = 255, message = "Email must be at most 255 characters")
        String email,

        @Schema(description = "Access level in the space", example = "EDIT")
        @NotNull(message = "accessLevel is required")
        DocumentAccessLevel accessLevel) {}
