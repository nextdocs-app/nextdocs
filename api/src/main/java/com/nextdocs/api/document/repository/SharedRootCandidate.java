package com.nextdocs.api.document.repository;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * One shared-root listing candidate with only the fields the listing needs before
 * pagination: who owns it, how it sorts, and the caller's navigation key.
 *
 * <p>Deliberately not a {@code Document}: loading the entity would materialise each
 * candidate's {@code yjs_state} byte array, and shared listings resolve effective
 * access for every candidate before they can paginate.
 */
public record SharedRootCandidate(
        UUID id, UUID ownerId, String title, OffsetDateTime createdAt, OffsetDateTime updatedAt, String orderKey) {}
