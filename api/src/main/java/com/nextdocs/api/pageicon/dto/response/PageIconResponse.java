package com.nextdocs.api.pageicon.dto.response;

import com.nextdocs.api.pageicon.PageIconType;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.Locale;

@Schema(description = "Page icon. Null when the target has no icon.")
public record PageIconResponse(
        @Schema(description = "Icon source in lowercase: emoji, builtin, upload, or link", example = "emoji")
        String type,

        @Schema(description = "Emoji grapheme, builtin slug, attachment id, or image URL", example = "📝")
        String value,

        @Schema(description = "Color for builtin icons: gray, brown, orange, etc. Null for default.", example = "blue")
        String color) {

    public PageIconResponse(String type, String value) {
        this(type, value, null);
    }

    /**
     * Maps a stored icon triple. A null type means "no icon" and answers null, so a
     * caller can pass the entity columns straight through instead of repeating the
     * guard. The wire type is the lowercase enum name.
     */
    public static PageIconResponse from(PageIconType type, String value, String color) {
        if (type == null) {
            return null;
        }
        return new PageIconResponse(type.name().toLowerCase(Locale.ROOT), value, color);
    }
}
