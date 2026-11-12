package com.nextdocs.api.search.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

@Schema(description = "A page of ranked search results")
public record SearchResponse(
        @Schema(description = "The trimmed query that was executed")
        String query,

        @Schema(description = "Ranked hits") List<SearchHitResponse> items,

        @Schema(description = "Whether a further page exists")
        boolean hasMore,

        @Schema(description = "Offset to request next when hasMore")
        int nextOffset) {}
