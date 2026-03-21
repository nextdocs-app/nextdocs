package com.nextdocs.api.document.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

@Schema(description = "Request body for creating a document")
public record DocumentCreateRequest(
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
        String createdBy,

        @Schema(description = "Optional local source ID for idempotent import/promotion", example = "local-123")
        @Size(max = 128, message = "sourceLocalId must be at most 128 characters")
        String sourceLocalId) {}
