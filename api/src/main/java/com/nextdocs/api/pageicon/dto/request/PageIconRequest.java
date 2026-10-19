package com.nextdocs.api.pageicon.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(
        description = "Page icon assignment. Absent (or explicit null) leaves the icon unchanged on update; "
                + "a null type clears it.")
public record PageIconRequest(
        @Schema(
                description = "Icon source: EMOJI, BUILTIN, UPLOAD, or LINK (case-insensitive). Null clears the icon.",
                example = "EMOJI")
        String type,

        @Schema(
                description = "Emoji grapheme, builtin slug, attachment id, or image URL, depending on type.",
                example = "📝")
        String value,

        @Schema(
                description =
                        "Color for builtin icons: default, gray, brown, orange, yellow, green, blue, purple, pink, red.",
                example = "blue")
        String color) {

    public PageIconRequest(String type, String value) {
        this(type, value, null);
    }
}
