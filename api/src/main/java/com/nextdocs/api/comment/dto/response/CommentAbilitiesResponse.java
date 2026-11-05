package com.nextdocs.api.comment.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * What the requesting caller may do with this comment. The client uses this to
 * show or hide controls; the API re-checks every mutation.
 */
@Schema(description = "Caller abilities on a comment")
public record CommentAbilitiesResponse(
        @Schema(description = "Caller wrote this comment and may edit it")
        boolean update,

        @Schema(description = "Caller may delete this comment")
        boolean delete,

        @Schema(description = "Caller may add or remove reactions")
        boolean reactions) {}
