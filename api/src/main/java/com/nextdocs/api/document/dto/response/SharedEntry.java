package com.nextdocs.api.document.dto.response;

import com.nextdocs.api.document.entity.DocumentAccessLevel;
import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * One visible Shared entry. {@code parentId} is the real parent, which may be
 * unreadable.
 *
 * <p>{@code owner} separates the two questions a client must not conflate: who owns
 * the page, and what the caller may do with it. An OWNER-level grant to a
 * collaborator answers {@code accessLevel=OWNER} with {@code owner=false}, so a
 * Shared entry can carry the top level without being the caller's own page.
 */
public record SharedEntry(
        UUID id,
        UUID parentId,
        UUID spaceId,
        String title,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt,
        String orderKey,
        DocumentAccessLevel accessLevel,
        boolean owner) {

    public SharedEntry withOrderKey(String newOrderKey) {
        return new SharedEntry(id, parentId, spaceId, title, createdAt, updatedAt, newOrderKey, accessLevel, owner);
    }
}
