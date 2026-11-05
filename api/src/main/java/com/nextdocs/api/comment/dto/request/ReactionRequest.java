package com.nextdocs.api.comment.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

@Schema(description = "Add an emoji reaction to a comment")
public record ReactionRequest(
        @Schema(description = "Emoji to react with", example = "\uD83D\uDC4D")
        @NotBlank(message = "emoji is required")
        @Size(max = 64, message = "emoji must be at most 64 characters")
        String emoji) {}
