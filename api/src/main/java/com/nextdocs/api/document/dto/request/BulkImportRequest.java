package com.nextdocs.api.document.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.List;

@Schema(description = "Bulk import request for local documents")
public record BulkImportRequest(
        @Schema(description = "Documents to import") @NotEmpty(message = "docs must not be empty")
        List<@NotNull @Valid BulkImportItemRequest> docs) {}
