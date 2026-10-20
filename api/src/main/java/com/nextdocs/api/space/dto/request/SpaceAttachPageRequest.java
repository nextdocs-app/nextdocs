package com.nextdocs.api.space.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

@Schema(description = "File an existing root page into a space")
public record SpaceAttachPageRequest(
        @Schema(description = "ID of the root page to move into the space") @NotNull(message = "documentId is required")
        UUID documentId) {}
