package com.nextdocs.api.document.validation;

import java.util.regex.Pattern;

/**
 * The builtin-icon slug grammar, shared by the catalog loader and every validator
 * that accepts a builtin icon value.
 *
 * <p>One home so the service that owns the glyph files and the applier that
 * validates a client request cannot disagree about what a well-formed slug is.
 * Catalog membership is a separate question ({@link IconCatalog#isValidSlug}); this
 * only rejects shapes that could not name a file, so malformed input is simply
 * invalid rather than an error. The client mirror lives in
 * {@code web/lib/document-icon.util.ts} and has to stay in step with it.
 */
public final class IconSlugs {

    private IconSlugs() {}

    private static final Pattern SLUG_PATTERN = Pattern.compile("[A-Za-z0-9]+(-[A-Za-z0-9]+)*");

    /** Longest accepted slug, matching the column and file-name budget on both sides. */
    public static final int MAX_LENGTH = 64;

    /**
     * Whether {@code slug} is syntactically valid: 1-64 characters of alphanumerics in
     * hyphen-separated groups. Never throws for malformed input — a hostile value is
     * invalid, not an error.
     */
    public static boolean isWellFormed(String slug) {
        return slug != null
                && slug.length() <= MAX_LENGTH
                && SLUG_PATTERN.matcher(slug).matches();
    }
}
