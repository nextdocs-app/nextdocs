package com.nextdocs.api.document.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "Cover image. Null when the document has no cover.")
public record DocumentCoverResponse(
        @Schema(description = "Cover source in lowercase: upload or link", example = "link")
        String type,

        @Schema(description = "Attachment id or image URL") String value,

        @Schema(description = "Vertical focal offset in [0, 1]", example = "0.5")
        Double position) {}
