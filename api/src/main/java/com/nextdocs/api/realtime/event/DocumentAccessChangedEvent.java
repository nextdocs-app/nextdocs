package com.nextdocs.api.realtime.event;

import java.util.Collections;
import java.util.List;
import java.util.UUID;

/**
 * An access change on a document.
 *
 * <p>{@code affectedUsers} is empty when the whole audience may have changed (a settings
 * change, a move, a trash); a non-empty list lets Yhub re-check only those identities.
 * {@code subtree} says whether descendants inherit the change, which is the normal case
 * for page grants and for structural moves.
 */
public record DocumentAccessChangedEvent(UUID documentId, List<UUID> affectedUsers, boolean subtree) {

    public DocumentAccessChangedEvent(UUID documentId) {
        this(documentId, Collections.emptyList(), true);
    }

    public DocumentAccessChangedEvent(UUID documentId, List<UUID> affectedUsers) {
        this(documentId, affectedUsers, true);
    }

    public static DocumentAccessChangedEvent documentOnly(UUID documentId, List<UUID> affectedUsers) {
        return new DocumentAccessChangedEvent(documentId, affectedUsers, false);
    }
}
