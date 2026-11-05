package com.nextdocs.api.comment.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * What the requesting caller may do with this thread. Mirrors the rules the editor
 * used before comments moved out of the Y.Doc: anyone who may comment may resolve,
 * while deleting a thread needs document edit access.
 */
@Schema(description = "Caller abilities on a thread")
public record ThreadAbilitiesResponse(
        @Schema(description = "Caller may delete the thread")
        boolean delete,

        @Schema(description = "Caller may resolve the thread")
        boolean resolve,

        @Schema(description = "Caller may reopen the thread")
        boolean unresolve) {}
