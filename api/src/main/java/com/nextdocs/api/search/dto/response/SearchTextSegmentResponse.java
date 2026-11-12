package com.nextdocs.api.search.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "Plain-text segment; matched segments are rendered emphasized")
public record SearchTextSegmentResponse(
        @Schema(description = "Segment text, never HTML") String text,

        @Schema(description = "Whether this segment matched the query")
        boolean match) {}
