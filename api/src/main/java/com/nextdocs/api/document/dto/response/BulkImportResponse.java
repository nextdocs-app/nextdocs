package com.nextdocs.api.document.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

@Schema(description = "Bulk import result")
public record BulkImportResponse(
        @Schema(description = "Imported documents") List<BulkImportItemResponse> imported) {}
