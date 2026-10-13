package com.nextdocs.api.document.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(
        description = "Cover image assignment. Absent (or explicit null) leaves the cover unchanged on update; "
                + "a null type clears it.")
public record DocumentCoverRequest(
        @Schema(
                description = "Cover source: UPLOAD or LINK (case-insensitive). Null clears the cover.",
                example = "LINK")
        String type,

        @Schema(description = "Attachment id or image URL, depending on type.")
        String value,

        @Schema(
                description =
                        "Vertical focal offset in [0, 1]. Null keeps the existing offset, or 0.5 for a new cover.",
                example = "0.5")
        Double position) {}
