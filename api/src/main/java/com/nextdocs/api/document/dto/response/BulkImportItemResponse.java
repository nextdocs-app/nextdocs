package com.nextdocs.api.document.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;

@Schema(description = "Single imported document mapping")
public record BulkImportItemResponse(
        @Schema(description = "Client local ID") String localId,
        @Schema(description = "Server document ID") UUID documentId,
        @Schema(description = "Imported title") String title) {}
