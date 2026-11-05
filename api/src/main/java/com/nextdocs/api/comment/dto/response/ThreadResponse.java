package com.nextdocs.api.comment.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * A discussion thread with its replies. The document anchor is not part of the
 * payload: BlockNote stores it as a comment mark in the Yjs document body, which
 * references {@link #id}.
 */
@Schema(description = "A comment thread and its replies")
public record ThreadResponse(
        @Schema(description = "Thread id (also referenced by the document's comment mark)")
        UUID id,

        @Schema(description = "Created at") OffsetDateTime createdAt,
        @Schema(description = "Last activity at") OffsetDateTime updatedAt,

        @Schema(description = "Whether the thread is resolved")
        boolean resolved,

        @Schema(description = "When the thread was resolved")
        OffsetDateTime resolvedUpdatedAt,

        @Schema(description = "Who resolved the thread") CommentAuthorResponse resolvedBy,
        @Schema(description = "Replies in creation order") List<CommentResponse> comments,
        @Schema(description = "Caller abilities") ThreadAbilitiesResponse abilities) {}
