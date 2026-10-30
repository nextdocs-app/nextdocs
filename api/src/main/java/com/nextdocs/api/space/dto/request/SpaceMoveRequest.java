package com.nextdocs.api.space.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;

@Schema(description = "Request body for reordering a space in the caller's sidebar")
public record SpaceMoveRequest(
        @Schema(description = "ID of the space immediately before the new position. Null means prepend.")
        UUID prevSiblingId,

        @Schema(description = "ID of the space immediately after the new position. Null means append.")
        UUID nextSiblingId) {}
