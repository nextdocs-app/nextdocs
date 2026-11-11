package com.nextdocs.api.document.repository;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * One flat Shared-listing candidate with only the fields a listing needs before
 * pagination: ownership, the parent that decides whether the page floats, the
 * owner's sibling key, and the sort keys.
 *
 * <p>Deliberately not a {@code Document}: loading the entity would materialise each
 * candidate's content, and shared listings resolve effective
 * access for every candidate before they can paginate.
 */
public record SharedDocumentCandidate(
        UUID id,
        UUID parentId,
        String siblingOrderKey,
        String title,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {}
