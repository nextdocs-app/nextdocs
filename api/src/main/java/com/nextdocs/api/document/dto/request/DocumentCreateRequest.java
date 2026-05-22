package com.nextdocs.api.document.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.UUID;

@Schema(description = "Request body for creating a document")
public record DocumentCreateRequest(
        @Schema(
                description = "Client-generated document ID. Must be a UUID.",
                example = "550e8400-e29b-41d4-a716-446655440000")
        UUID id,

        @Schema(description = "Document title", example = "My First Doc")
        @NotBlank(message = "Title is required")
        @Size(max = 255, message = "Title must be at most 255 characters")
        String title,

        @Schema(description = "Base64-encoded Yjs state")
        @NotBlank(message = "yjsState is required")
        @Size(max = 10_485_760, message = "yjsState must be at most 10485760 characters (~10 MB Base64 payload)")
        String yjsState,

        @Schema(description = "Optional creator label", example = "Anonymous")
        @Size(max = 255, message = "createdBy must be at most 255 characters")
        String createdBy) {}
