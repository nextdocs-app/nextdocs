package com.nextdocs.api.attachment;

import java.util.Set;

/**
 * Content types the API treats as safely renderable inline in a browser.
 *
 * <p>Single home for the raster-image allowlist so the download headers and
 * the page icon/cover validation cannot drift apart: SVG stays excluded
 * because uploaded SVG is scriptable XML.
 */
public final class AttachmentContentTypes {

    private AttachmentContentTypes() {}

    /** Raster image types a browser renders without executing embedded scripts. */
    public static final Set<String> INLINE_RASTER_IMAGE_TYPES =
            Set.of("image/png", "image/jpeg", "image/gif", "image/webp", "image/avif");
}
