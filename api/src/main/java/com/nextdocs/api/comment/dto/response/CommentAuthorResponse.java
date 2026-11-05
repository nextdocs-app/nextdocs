package com.nextdocs.api.comment.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;

/**
 * How a comment author is rendered. {@code id} is the stable user key recorded at
 * write time, so it survives account deletion; it is null only for anonymous
 * share-link commenters, whose client-side identity is the shared "anonymous" id.
 * The display name falls back to the snapshot taken when the comment was written.
 */
@Schema(description = "Comment author identity and display profile")
public record CommentAuthorResponse(
        @Schema(description = "Author user id, or null for an anonymous guest")
        UUID id,

        @Schema(description = "Display name") String displayName,

        @Schema(description = "Avatar URL, when the account still exists")
        String avatarUrl) {}
