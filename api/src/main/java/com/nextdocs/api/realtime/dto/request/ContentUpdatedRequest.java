package com.nextdocs.api.realtime.dto.request;

import java.util.List;
import java.util.UUID;

/**
 * Body of the realtime content-updated notification.
 *
 * <p>Every field except the document id is optional so a rolling deploy is safe in both
 * directions: an older realtime build sends only {@code ?documentId=}, and a newer one
 * also carries the extracted text and the document's current mention set.
 *
 * <p>{@code mentions == null} means the sender could not extract them; an empty list is
 * a legitimate "this document mentions nobody".
 */
public record ContentUpdatedRequest(
        UUID documentId,
        String text,
        Boolean truncated,
        String producedAt,
        Boolean reindex,
        List<MentionRef> mentions) {

    /** A mention found in the Y.Doc. Only the stable user id travels. */
    public record MentionRef(UUID userId) {}
}
