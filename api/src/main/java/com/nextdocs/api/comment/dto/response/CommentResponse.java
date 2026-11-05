package com.nextdocs.api.comment.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

@Schema(description = "A comment in a thread")
public record CommentResponse(
        @Schema(description = "Comment id") UUID id,
        @Schema(description = "Author") CommentAuthorResponse author,

        @Schema(description = "BlockNote comment body (JSON array of blocks)")
        JsonNode body,

        @Schema(description = "Created at") OffsetDateTime createdAt,
        @Schema(description = "Last edited at") OffsetDateTime updatedAt,

        @Schema(description = "Emoji reactions, aggregated by emoji")
        List<CommentReactionResponse> reactions,

        @Schema(description = "Caller abilities") CommentAbilitiesResponse abilities) {}
