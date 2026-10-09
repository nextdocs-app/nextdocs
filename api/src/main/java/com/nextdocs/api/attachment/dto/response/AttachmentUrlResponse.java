package com.nextdocs.api.attachment.dto.response;

import java.time.Instant;

/** A freshly signed (or configured public-base-prefixed) download URL. */
public record AttachmentUrlResponse(String url, Instant expiresAt) {}
