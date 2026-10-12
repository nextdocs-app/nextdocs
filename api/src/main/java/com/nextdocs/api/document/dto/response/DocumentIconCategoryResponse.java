package com.nextdocs.api.document.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

@Schema(description = "One section of the builtin page-icon catalog")
public record DocumentIconCategoryResponse(
        @Schema(description = "Category id, usable as a section key")
        String id,

        @Schema(description = "Category label shown as the section header")
        String label,

        @Schema(description = "Icon slugs in this category, in display order")
        List<String> icons) {}
