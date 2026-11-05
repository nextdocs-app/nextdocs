package com.nextdocs.api.document.dto.request;

import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.entity.DocumentGeneralAccessMode;
import com.nextdocs.api.document.entity.DocumentWorkspaceAccessMode;
import com.nextdocs.api.document.validation.ValidSharingSettings;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.OffsetDateTime;

@Schema(description = "Update document general sharing settings")
@ValidSharingSettings
public record SharingSettingsUpdateRequest(
        @Schema(description = "General access mode. Omit to leave it unchanged.", example = "ANYONE_WITH_LINK")
        DocumentGeneralAccessMode generalAccessMode,

        @Schema(description = "Default access level for anyone-with-link mode", example = "VIEW")
        DocumentAccessLevel linkAccessLevel,

        @Schema(
                description = "Block share-link inheritance for this document and its descendants. "
                        + "Omit to leave unchanged. Only meaningful with RESTRICTED; setting "
                        + "ANYONE_WITH_LINK clears the block. Stored only when it shadows an "
                        + "ancestor's link grant, so true can come back false: read the returned "
                        + "linkInheritBlocked as the effective state rather than assuming this "
                        + "value stuck.",
                example = "true")
        Boolean linkInheritBlocked,

        @Schema(description = "General access for signed-in workspace members")
        DocumentWorkspaceAccessMode workspaceAccessMode,

        @Schema(description = "Access level for signed-in workspace members")
        DocumentAccessLevel workspaceAccessLevel,

        @Schema(description = "Block inherited workspace-member access on this page")
        Boolean workspaceInheritBlocked,

        @Schema(
                description = "When the share link lapses. Only valid with ANYONE_WITH_LINK; "
                        + "omit to leave it unchanged, or set clearLinkExpiresAt to clear it."
                        + " An expired link stops granting access and stops hiding an ancestor's link.",
                example = "2026-12-31T23:59:59Z")
        OffsetDateTime linkExpiresAt,

        @Schema(description = "Explicitly clear the existing share-link expiry")
        Boolean clearLinkExpiresAt) {

    public SharingSettingsUpdateRequest(
            DocumentGeneralAccessMode generalAccessMode,
            DocumentAccessLevel linkAccessLevel,
            Boolean linkInheritBlocked) {
        this(generalAccessMode, linkAccessLevel, linkInheritBlocked, null, null, null, null, null);
    }

    public SharingSettingsUpdateRequest(
            DocumentGeneralAccessMode generalAccessMode,
            DocumentAccessLevel linkAccessLevel,
            Boolean linkInheritBlocked,
            DocumentWorkspaceAccessMode workspaceAccessMode,
            DocumentAccessLevel workspaceAccessLevel,
            Boolean workspaceInheritBlocked,
            OffsetDateTime linkExpiresAt) {
        this(
                generalAccessMode,
                linkAccessLevel,
                linkInheritBlocked,
                workspaceAccessMode,
                workspaceAccessLevel,
                workspaceInheritBlocked,
                linkExpiresAt,
                null);
    }
}
