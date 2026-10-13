package com.nextdocs.api.document.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.Map;

@Schema(
        description = "Every builtin page-icon glyph in one response, so the picker grid "
                + "renders without one HTTP request per icon")
public record DocumentIconBundleResponse(
        @Schema(description = "Icon slug to sanitized SVG text")
        Map<String, String> icons,

        @Schema(description = "Upstream source of the icons")
        String source,

        @Schema(description = "License the icons are used under")
        String license) {}
