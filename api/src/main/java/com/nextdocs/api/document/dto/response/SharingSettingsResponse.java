package com.nextdocs.api.document.dto.response;

import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.entity.DocumentGeneralAccessMode;
import io.swagger.v3.oas.annotations.media.Schema;
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
                        + "its descendants (general-access analogue of a NO_ACCESS breakpoint)")
        boolean linkInheritBlocked) {

    public SharingSettingsResponse(
            DocumentGeneralAccessMode generalAccessMode, DocumentAccessLevel linkAccessLevel, boolean hasActiveLink) {
        this(generalAccessMode, linkAccessLevel, hasActiveLink, false, null, null, false);
    }
}
