package com.nextdocs.api.realtime.service;

import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.dto.response.DocumentContentResponse;
import com.nextdocs.api.realtime.client.YhubClient;
import java.util.Base64;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Reads a document's content from Yhub for first paint.
 *
 * <p>Yhub is the only content store. A never-written room is not an error: it simply
 * has no content yet, and the client's first socket connection creates it. A transient
 * Yhub failure is surfaced as 503 so the browser can fall back to its IndexedDB copy
 * instead of painting an empty editor over real content.
 */
@Service
public class DocumentContentService {

    private final YhubClient yhubClient;

    public DocumentContentService(YhubClient yhubClient) {
        this.yhubClient = yhubClient;
    }

    public DocumentContentResponse read(UUID documentId) {
        YhubClient.UpdateFetch fetch = yhubClient.fetchUpdate(documentId);
        if (fetch.status() == YhubClient.FetchStatus.TRANSIENT) {
            throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
        }

        byte[] update = fetch.status() == YhubClient.FetchStatus.OK ? fetch.update() : null;
        String encoded = update == null || update.length == 0
                ? null
                : Base64.getEncoder().encodeToString(update);
        return new DocumentContentResponse(encoded);
    }
}
