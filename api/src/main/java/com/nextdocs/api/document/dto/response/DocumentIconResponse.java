package com.nextdocs.api.document.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "Page icon. Null when the document has no icon.")
public record DocumentIconResponse(
        @Schema(description = "Icon source in lowercase: emoji, builtin, upload, or link", example = "emoji")
        String type,

        @Schema(description = "Emoji grapheme, builtin slug, attachment id, or image URL", example = "📝")
        String value,

        @Schema(description = "Color for builtin icons: gray, brown, orange, etc. Null for default.", example = "blue")
        String color) {

    public DocumentIconResponse(String type, String value) {
        this(type, value, null);
    }
}
