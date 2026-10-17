package com.nextdocs.api.attachment;

import java.util.Objects;
import java.util.UUID;

/**
 * What an attachment belongs to.
 *
 * <p>One scope concept instead of the old document-assumed model: authorization,
 * the storage key, and the foreign key the row is bound to all switch on this
 * value, so adding a scope (spaces) is a new enum constant plus one policy branch
 * rather than a second set of code paths.
 */
public record AttachmentScope(Kind kind, UUID id) {

    public enum Kind {
        DOCUMENT,
        WORKSPACE
    }

    public AttachmentScope {
        Objects.requireNonNull(kind, "kind");
        Objects.requireNonNull(id, "id");
    }

    public static AttachmentScope document(UUID documentId) {
        return new AttachmentScope(Kind.DOCUMENT, documentId);
    }

    public static AttachmentScope workspace(UUID workspaceId) {
        return new AttachmentScope(Kind.WORKSPACE, workspaceId);
    }
}
