package com.nextdocs.api.document.entity;

/** How a document's page icon is sourced. NULL on the row means no icon. */
public enum DocumentIconType {
    /** A single emoji grapheme stored inline. */
    EMOJI,
    /** A slug from the server-provided builtin icon catalog. */
    BUILTIN,
    /** An uploaded image referenced by attachment id. */
    UPLOAD,
    /** An external image URL. */
    LINK
}
