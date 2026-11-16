package com.nextdocs.api.document.repository;

import com.nextdocs.api.document.entity.DocumentAccessLevel;
import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * One visible entry in the caller's Shared section, with effective access already
 * resolved by the candidate query.
 *
 * <p>{@code owner} is direct ownership of the row, which is not the same thing as
 * {@code accessLevel}: a collaborator can hold an OWNER-level grant without owning
 * the page, and a caller's own page reports OWNER whether or not it carries a grant.
 *
 * <p>Deliberately lean: the listing resolves the single-home predicate in SQL before
 * it can paginate, so loading {@code Document} rows here would materialise every
 * candidate's metadata for pages that never render.
 */
public record SharedSectionCandidate(
        UUID id,
        UUID parentId,
        UUID spaceId,
        String title,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt,
        DocumentAccessLevel accessLevel,
        boolean owner) {}
