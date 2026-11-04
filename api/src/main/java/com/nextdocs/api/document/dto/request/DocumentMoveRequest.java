package com.nextdocs.api.document.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;

@Schema(description = "Request body for moving a document")
public record DocumentMoveRequest(
        @Schema(
                description = "Target parent document ID. Null reorders at the caller's root level; "
                        + "a nested page stays under its real parent unless detachFromParent is true.")
        UUID newParentId,

        @Schema(description = "ID of the sibling immediately before the new position. Null means prepend.")
        UUID prevSiblingId,

        @Schema(description = "ID of the sibling immediately after the new position. Null means append.")
        UUID nextSiblingId,

        @Schema(
                description = "Explicitly detach a nested page from its parent. Required to move a "
                        + "nested space page to the root; omitted or false only reorders it in the "
                        + "caller's Shared section.",
                example = "false")
        Boolean detachFromParent) {

    public DocumentMoveRequest(UUID newParentId, UUID prevSiblingId, UUID nextSiblingId) {
        this(newParentId, prevSiblingId, nextSiblingId, false);
    }
}
