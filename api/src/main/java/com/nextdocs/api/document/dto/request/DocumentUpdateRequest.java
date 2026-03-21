package com.nextdocs.api.document.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Size;

@Schema(description = "Request body for updating a document")
public record DocumentUpdateRequest(
        @Schema(description = "Document title") @Size(max = 255, message = "Title must be at most 255 characters")
        String title,

        @Schema(description = "Base64-encoded Yjs state") String yjsState,

        @Schema(description = "Optional creator label")
        @Size(max = 255, message = "createdBy must be at most 255 characters")
        String createdBy) {}
