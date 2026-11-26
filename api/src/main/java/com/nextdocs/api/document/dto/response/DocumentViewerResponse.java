package com.nextdocs.api.document.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * One person who has opened the document, for the toolbar's viewer group.
 *
 * <p>This is view history, not sharing: no access level and no email. A visit is a fact
 * about what happened, so the row survives a later revocation; the sharing roster stays
 * the only answer to "who may do what here".
 */
@Schema(description = "A person who has viewed the document")
public record DocumentViewerResponse(
        @Schema(description = "User ID") UUID userId,
        @Schema(description = "Display name") String displayName,
        @Schema(description = "Avatar URL, when set") String avatarUrl,

        @Schema(description = "When this person last opened the document")
        OffsetDateTime lastViewedAt) {}
