package com.nextdocs.api.document.entity;

/** How a document's cover image is sourced. NULL on the row means no cover. */
public enum DocumentCoverType {
    /** An uploaded image referenced by attachment id. */
    UPLOAD,
    /** An external image URL. */
    LINK
}
