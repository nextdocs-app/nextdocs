package com.nextdocs.api.document.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;

/**
 * Raw versus effective access for the sharing explanation panel.
 *
 * <p>{@code identityLevel} keeps {@code NO_ACCESS} rather than mapping it to null: that
 * distinction is the whole point of explain. A live link can still raise the effective
 * level above a denied identity, which is why {@code denied} is about the final result
 * and {@code identityDenied} is about the identity channel alone.
 */
@Schema(description = "Why a page does or does not resolve access")
public record AccessExplainResponse(
        UUID documentId,

        @Schema(description = "Winning level, or NO_ACCESS when nothing grants access")
        String effectiveLevel,

        @Schema(description = "Identity channel raw level, including NO_ACCESS")
        String identityLevel,

        @Schema(description = "Anonymous link channel raw level, if any")
        String linkLevel,

        @Schema(description = "IDENTITY or LINK") String channel,

        @Schema(description = "Whether the page has no readable access at all")
        boolean denied,

        @Schema(description = "Whether the identity channel itself is denied")
        boolean identityDenied) {}
