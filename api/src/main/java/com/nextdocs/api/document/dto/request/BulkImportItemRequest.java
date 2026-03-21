package com.nextdocs.api.document.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

@Schema(description = "Single document payload for bulk import")
public record BulkImportItemRequest(
        @Schema(description = "Client-side local document ID", example = "local-123")
        String localId,

        @Schema(description = "Document title", example = "Imported Doc")
        @NotBlank(message = "Title is required")
        @Size(max = 255, message = "Title must be at most 255 characters")
        String title,

        @Schema(description = "Base64-encoded Yjs state") @NotBlank(message = "yjsState is required")
        String yjsState,

        @Schema(description = "Optional creator label")
        @Size(max = 255, message = "createdBy must be at most 255 characters")
        String createdBy) {}
