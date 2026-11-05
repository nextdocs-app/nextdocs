package com.nextdocs.api.comment.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import tools.jackson.databind.JsonNode;

@Schema(description = "A BlockNote comment body: an array of comment blocks")
public record CommentBodyRequest(
        @Schema(description = "BlockNote comment document (JSON array)") @NotNull(message = "body is required")
        JsonNode body) {}
