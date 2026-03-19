package com.nextdocs.api.auth.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;

@Schema(description = "Authenticated user profile")
public record UserResponse(
        @Schema(description = "User ID") UUID id,

        @Schema(description = "Email address") String email,

        @Schema(description = "Display name") String displayName,

        @Schema(description = "Avatar URL, may be null") String avatarUrl,

        @Schema(description = "Whether the email address has been verified")
        boolean emailVerified) {}
