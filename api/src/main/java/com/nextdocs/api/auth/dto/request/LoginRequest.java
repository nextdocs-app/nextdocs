package com.nextdocs.api.auth.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

@Schema(description = "Request body for email + password login")
public record LoginRequest(
        @Schema(description = "Registered email address", example = "jane@example.com")
        @NotBlank(message = "Email is required")
        @Email(message = "Must be a valid email address")
        String email,

        @Schema(description = "Account password", format = "password") @NotBlank(message = "Password is required")
        String password) {}
