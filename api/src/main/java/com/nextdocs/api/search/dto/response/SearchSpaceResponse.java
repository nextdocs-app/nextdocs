package com.nextdocs.api.search.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;

@Schema(description = "Space a search hit belongs to")
public record SearchSpaceResponse(
        @Schema(description = "Space ID") UUID id,
        @Schema(description = "Space name") String name) {}
