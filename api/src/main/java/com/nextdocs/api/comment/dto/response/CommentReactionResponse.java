package com.nextdocs.api.comment.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * Reactions aggregated by emoji, the shape BlockNote's comment UI expects
 * ({@code emoji}, first reaction time, and the reacting users).
 */
@Schema(description = "An emoji reaction and the users who chose it")
public record CommentReactionResponse(
        @Schema(description = "Emoji") String emoji,

        @Schema(description = "When the first user reacted with this emoji")
        OffsetDateTime createdAt,

        @Schema(description = "Users who reacted with this emoji")
        List<CommentAuthorResponse> users) {}
