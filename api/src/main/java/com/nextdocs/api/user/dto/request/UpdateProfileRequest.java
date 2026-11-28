package com.nextdocs.api.user.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

@Schema(description = "Request body for changing the signed-in account's display name")
public record UpdateProfileRequest(
        @Schema(description = "Name shown in documents, comments and member lists", example = "Jane Doe")
        @NotBlank(message = "Display name is required")
        @Size(max = 100, message = "Display name must be at most 100 characters")
        String displayName) {}
