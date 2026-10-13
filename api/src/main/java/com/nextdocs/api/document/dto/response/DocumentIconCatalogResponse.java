package com.nextdocs.api.document.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

@Schema(description = "Builtin page-icon catalog")
public record DocumentIconCatalogResponse(
        // Both shapes ship on purpose: `names` is the baseline a client reads
        // without understanding sections (and the flat grid's order), while
        // `categories` groups the same 995 slugs under picker headers. Dropping
        // either would make every client reassemble it; the ~15KB duplication is
        // paid once per cached response.
        @Schema(description = "Icon slugs usable as builtin icon values")
        List<String> names,

        @Schema(description = "Picker sections, in display order")
        List<DocumentIconCategoryResponse> categories,

        @Schema(description = "Upstream source of the icons")
        String source,

        @Schema(description = "License the icons are used under")
        String license) {}
