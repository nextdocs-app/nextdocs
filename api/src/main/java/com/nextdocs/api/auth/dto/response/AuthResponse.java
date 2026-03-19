package com.nextdocs.api.auth.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "Successful authentication response. The refresh token is delivered via HTTP-only cookie.")
public record AuthResponse(
        @Schema(description = "Short-lived JWT access token (15 min). Include as 'Authorization: Bearer <token>'.")
        String accessToken,

        @Schema(description = "Token type, always 'Bearer'") String tokenType,

        @Schema(description = "Access token lifetime in seconds")
        long expiresIn,

        @Schema(description = "Authenticated user details") UserResponse user) {

    public static AuthResponse of(String accessToken, long expiresInSeconds, UserResponse user) {
        return new AuthResponse(accessToken, "Bearer", expiresInSeconds, user);
    }
}
