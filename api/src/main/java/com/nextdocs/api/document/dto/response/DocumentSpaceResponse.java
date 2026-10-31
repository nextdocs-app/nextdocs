package com.nextdocs.api.document.dto.response;

import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.space.entity.SpaceAccessMode;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;

@Schema(description = "Space context for a document inside a space")
public record DocumentSpaceResponse(
        @Schema(description = "Space ID") UUID id,
        @Schema(description = "Space name") String name,

        @Schema(description = "PUBLIC (every workspace member inherits everyoneAccessLevel) or CUSTOM")
        SpaceAccessMode accessMode,

        @Schema(description = "Level every workspace member inherits while PUBLIC")
        DocumentAccessLevel everyoneAccessLevel,

        @Schema(description = "The caller's effective level in the space; VIEW while archived")
        DocumentAccessLevel myAccessLevel,

        @Schema(description = "Whether the caller may administer the space")
        boolean canAdminister,

        @Schema(description = "Whether the space is archived; sharing is frozen until restored")
        boolean archived) {}
