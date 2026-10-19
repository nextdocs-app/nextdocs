package com.nextdocs.api.pageicon;

/** How a page icon (document or workspace) is sourced. NULL on the row means no icon. */
public enum PageIconType {
    /** A single emoji grapheme stored inline. */
    EMOJI,
    /** A slug from the server-provided builtin icon catalog. */
    BUILTIN,
    /** An uploaded image referenced by attachment id. */
    UPLOAD,
    /** An external image URL. */
    LINK
}
