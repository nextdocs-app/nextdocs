package com.nextdocs.api.auth.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

@Schema(description = "Request body for user registration")
public record RegisterRequest(
        @Schema(description = "Valid email address", example = "jane@example.com")
        @NotBlank(message = "Email is required")
        @Email(message = "Must be a valid email address")
        String email,

        @Schema(description = "Display name shown in the UI", example = "Jane Doe")
        @NotBlank(message = "Display name is required")
        @Size(min = 2, max = 100, message = "Display name must be between 2 and 100 characters")
        String displayName,

        @Schema(description = "Password (min 8 characters)", example = "Secure@123")
        @NotBlank(message = "Password is required")
        @Size(min = 8, max = 128, message = "Password must be between 8 and 128 characters")
        String password) {

    @Override
    public String toString() {
        return "RegisterRequest[email=" + email + ", displayName=" + displayName + ", password=[PROTECTED]]";
    }
}
