package com.nextdocs.api.document.dto.response;

import com.nextdocs.api.document.entity.DocumentAccessLevel;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.OffsetDateTime;
import java.util.UUID;

@Schema(description = "Collaborator entry")
public record CollaboratorResponse(
        @Schema(description = "User ID") UUID userId,
        @Schema(description = "User email") String email,
        @Schema(description = "Display name") String displayName,
        @Schema(description = "Access level") DocumentAccessLevel accessLevel,

        @Schema(description = "Collaborator grant timestamp")
        OffsetDateTime addedAt,

        @Schema(description = "Whether this is the direct document owner")
        boolean owner,

        @Schema(description = "Whether access is inherited from an ancestor document")
        boolean inherited,

        @Schema(description = "ID of the ancestor document from which access is inherited")
        UUID inheritedFromId,

        @Schema(description = "Title of the ancestor document from which access is inherited")
        String inheritedFromTitle,

        @Schema(description = "Access level granted on the ancestor document")
        DocumentAccessLevel inheritedAccessLevel) {

    public CollaboratorResponse(
            UUID userId,
            String email,
            String displayName,
            DocumentAccessLevel accessLevel,
            OffsetDateTime addedAt,
            boolean owner) {
        this(userId, email, displayName, accessLevel, addedAt, owner, false, null, null, null);
    }
}
