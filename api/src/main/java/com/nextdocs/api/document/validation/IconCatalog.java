package com.nextdocs.api.document.validation;

/**
 * Minimal view of the builtin page-icon catalog, so validators can accept
 * catalogued slugs without depending on the service that serves the files.
 */
public interface IconCatalog {

    /** Whether {@code slug} names a catalogued icon. */
    boolean isValidSlug(String slug);
}
