package com.nextdocs.api.document.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;

@Schema(description = "Request body for moving a document")
public record DocumentMoveRequest(
        @Schema(description = "Target parent document ID. Null means move to root level.")
        UUID newParentId,

        @Schema(description = "ID of the sibling immediately before the new position. Null means prepend.")
        UUID prevSiblingId,

        @Schema(description = "ID of the sibling immediately after the new position. Null means append.")
        UUID nextSiblingId) {}
