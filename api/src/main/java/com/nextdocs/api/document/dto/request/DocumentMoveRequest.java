package com.nextdocs.api.document.dto.request;

import com.nextdocs.api.document.entity.DocumentOrderSection;
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
                        + "nested space page to the root; omitted or false keeps the parent and only "
                        + "reorders the page in the caller's navigation, which `section` names.",
                example = "false")
        Boolean detachFromParent,

        @Schema(
                description = "Personal navigation section this reorder belongs to. SHARED writes only "
                        + "the caller's Shared order and never the space's shared order; PRIVATE is the "
                        + "Private tree. Omit to let the server infer the section from the document's "
                        + "current home.")
        DocumentOrderSection section) {

    public DocumentMoveRequest(UUID newParentId, UUID prevSiblingId, UUID nextSiblingId) {
        this(newParentId, prevSiblingId, nextSiblingId, false, null);
    }

    public DocumentMoveRequest(UUID newParentId, UUID prevSiblingId, UUID nextSiblingId, Boolean detachFromParent) {
        this(newParentId, prevSiblingId, nextSiblingId, detachFromParent, null);
    }
}
