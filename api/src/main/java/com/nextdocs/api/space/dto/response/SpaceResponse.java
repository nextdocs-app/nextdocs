package com.nextdocs.api.space.dto.response;

import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.pageicon.dto.response.PageIconResponse;
import com.nextdocs.api.space.entity.SpaceAccessMode;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.OffsetDateTime;
import java.util.UUID;

@Schema(description = "Space summary")
public record SpaceResponse(
        @Schema(description = "Space ID") UUID id,

        @Schema(description = "Space name") String name,

        @Schema(description = "Space icon, null when it has none")
        PageIconResponse icon,

        @Schema(description = "PUBLIC (every member inherits everyoneAccessLevel) or CUSTOM")
        SpaceAccessMode accessMode,

        @Schema(description = "Level every workspace member inherits while PUBLIC")
        DocumentAccessLevel everyoneAccessLevel,

        @Schema(
                description =
                        "The caller's effective level in the space; null for a workspace admin who is not a member")
        DocumentAccessLevel myAccessLevel,

        @Schema(description = "Whether the caller may rename, re-share, and administer this space")
        boolean canAdminister,

        @Schema(description = "Number of listed members") long memberCount,

        @Schema(description = "Number of active root pages in the space")
        long pageCount,

        @Schema(description = "Creation timestamp") OffsetDateTime createdAt,

        @Schema(description = "Last update timestamp") OffsetDateTime updatedAt) {}
