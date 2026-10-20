package com.nextdocs.api.space.entity;

import java.util.Locale;

/**
 * Who may read a space's pages.
 *
 * <p>There is deliberately no {@code PRIVATE} value: pages without a space already
 * live in the caller's Private/Shared sections, so a third private bucket would
 * describe the same thing twice.
 */
public enum SpaceAccessMode {
    /** Every member of the workspace inherits {@code everyoneAccessLevel}. */
    PUBLIC,
    /** Only listed members have access; everybody else gets nothing. */
    CUSTOM;

    /** Case-insensitive parse of a wire value, e.g. {@code "custom"}. */
    public static SpaceAccessMode parse(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("Access mode cannot be null or blank");
        }
        return SpaceAccessMode.valueOf(raw.strip().toUpperCase(Locale.ROOT));
    }
}
