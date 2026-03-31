package com.nextdocs.api.document.dto.request;

import com.nextdocs.api.document.entity.DocumentAccessLevel;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

@Schema(description = "Add or update collaborator by email")
public record CollaboratorUpsertRequest(
        @Schema(description = "Collaborator email", example = "alice@example.com")
        @Email(message = "Email must be valid")
        @NotBlank(message = "Email is required")
        @Size(max = 255, message = "Email must be at most 255 characters")
        String email,

        @Schema(description = "Access level", example = "EDIT") @NotNull(message = "accessLevel is required")
        DocumentAccessLevel accessLevel) {}
