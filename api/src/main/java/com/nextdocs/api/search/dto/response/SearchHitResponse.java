package com.nextdocs.api.search.dto.response;

import com.nextdocs.api.pageicon.dto.response.PageIconResponse;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

@Schema(description = "One ranked search result")
public record SearchHitResponse(
        @Schema(description = "Document ID") UUID documentId,

        @Schema(description = "Title split into plain-text segments")
        List<SearchTextSegmentResponse> title,

        @Schema(description = "Body excerpt split into plain-text segments; empty for suggestions")
        List<SearchTextSegmentResponse> snippet,

        @Schema(description = "Ancestors from root to parent; empty for a root page")
        List<SearchBreadcrumbResponse> breadcrumb,

        @Schema(description = "Space containing the page, null for private pages")
        SearchSpaceResponse space,

        @Schema(description = "Page icon, null when the document has none")
        PageIconResponse icon,

        @Schema(description = "Last update timestamp") OffsetDateTime updatedAt) {}
