package com.nextdocs.api.realtime.dto.request;

import java.util.UUID;

/**
 * Body of the realtime content-updated notification.
 *
 * <p>Every field except the document id is optional so a rolling deploy is safe in both
 * directions: an older realtime build sends only {@code ?documentId=}, and a newer one
 * also carries the extracted text.
 */
public record ContentUpdatedRequest(
        UUID documentId, String text, Boolean truncated, String producedAt, Boolean reindex) {}
