package com.nextdocs.api.document.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * The base64-encoded Yjs update for one document, read from Yhub on demand.
 * An absent value means the room has no content yet; the client starts empty and
 * the socket creates the room on connection.
 */
@Schema(description = "Document content read from Yhub")
public record DocumentContentResponse(
        @Schema(description = "Base64-encoded Yjs update, or null when the room is empty")
        String content) {}
