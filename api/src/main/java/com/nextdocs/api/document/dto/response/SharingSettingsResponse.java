package com.nextdocs.api.document.dto.response;

import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.entity.DocumentGeneralAccessMode;
import com.nextdocs.api.document.entity.DocumentWorkspaceAccessMode;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.OffsetDateTime;
import java.util.UUID;

@Schema(description = "Document sharing settings")
public record SharingSettingsResponse(
        @Schema(description = "General access mode") DocumentGeneralAccessMode generalAccessMode,

        @Schema(description = "Access level for share links")
        DocumentAccessLevel linkAccessLevel,

        @Schema(description = "Whether an active share link exists")
        boolean hasActiveLink,

        @Schema(description = "Whether general access is inherited from an ancestor")
        boolean inherited,

        @Schema(description = "ID of the ancestor document from which general access is inherited")
        UUID inheritedFromId,

        @Schema(description = "Title of the ancestor document from which general access is inherited")
        String inheritedFromTitle,

        @Schema(
                description = "Whether this document blocks share-link inheritance for itself and "
                        + "its descendants (general-access analogue of a NO_ACCESS breakpoint). "
                        + "This is the effective state, not an echo of the request: a block that "
                        + "would shadow no ancestor link grant is normalized away and reports false.")
        boolean linkInheritBlocked,

        @Schema(description = "When the own share link lapses; null when it does not")
        OffsetDateTime linkExpiresAt,

        @Schema(description = "General access for signed-in workspace members")
        DocumentWorkspaceAccessMode workspaceAccessMode,

        @Schema(description = "Access level for signed-in workspace members")
        DocumentAccessLevel workspaceAccessLevel,

        @Schema(description = "Whether this document blocks inherited workspace-member access")
        boolean workspaceInheritBlocked,

        @Schema(description = "Whether workspace-member access is inherited from an ancestor")
        boolean workspaceInherited,

        @Schema(description = "ID of the ancestor that provides workspace-member access")
        UUID workspaceInheritedFromId,

        @Schema(description = "Title of the ancestor that provides workspace-member access")
        String workspaceInheritedFromTitle) {

    public SharingSettingsResponse(
            DocumentGeneralAccessMode generalAccessMode, DocumentAccessLevel linkAccessLevel, boolean hasActiveLink) {
        this(
                generalAccessMode,
                linkAccessLevel,
                hasActiveLink,
                false,
                null,
                null,
                false,
                null,
                null,
                null,
                false,
                false,
                null,
                null);
    }

    public SharingSettingsResponse(
            DocumentGeneralAccessMode generalAccessMode,
            DocumentAccessLevel linkAccessLevel,
            boolean hasActiveLink,
            boolean inherited,
            UUID inheritedFromId,
            String inheritedFromTitle,
            boolean linkInheritBlocked) {
        this(
                generalAccessMode,
                linkAccessLevel,
                hasActiveLink,
                inherited,
                inheritedFromId,
                inheritedFromTitle,
                linkInheritBlocked,
                null,
                null,
                null,
                false,
                false,
                null,
                null);
    }
}
