package com.nextdocs.api.document.dto.response;

import com.nextdocs.api.document.entity.DocumentAccessLevel;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;

@Schema(description = "Effective access for a specific document")
public record DocumentAccessResponse(
        @Schema(description = "Document ID") UUID documentId,
        @Schema(description = "Whether access is granted") boolean allowed,
        @Schema(description = "Effective access level") DocumentAccessLevel accessLevel,

        @Schema(description = "Whether current user is owner")
        boolean owner,

        @Schema(
                description =
                        "Whether the document is currently in trash. Trash-scope responses report the caller's pre-trash access level.",
                defaultValue = "false")
        boolean trashed,

        @Schema(description = "Whether the caller may manage sharing for this document")
        boolean canManageSharing,

        @Schema(description = "Space context when the document lives in a space")
        DocumentSpaceResponse space) {

    public DocumentAccessResponse(UUID documentId, boolean allowed, DocumentAccessLevel accessLevel, boolean owner) {
        this(documentId, allowed, accessLevel, owner, false, false, null);
    }

    public DocumentAccessResponse(
            UUID documentId, boolean allowed, DocumentAccessLevel accessLevel, boolean owner, boolean trashed) {
        this(documentId, allowed, accessLevel, owner, trashed, false, null);
    }
}
