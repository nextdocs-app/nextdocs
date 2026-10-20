package com.nextdocs.api.document.dto.response;

import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * Builds the list/tree projection of a {@link Document}.
 *
 * <p>The page icon and cover come from {@link DocumentIconCoverMapper}, so every
 * call site goes through one place and the enum-to-wire pair cannot be forgotten
 * or reordered — it used to be spelled out verbatim at each construction.
 */
public final class DocumentResponses {

    private DocumentResponses() {}

    /**
     * A document without its Yjs state, for list and tree responses.
     *
     * @param parentId the row's parent, or null for root-level
     * @param deletedAt when the document was trashed, or null
     * @param purgeAt when it will be purged, or null
     */
    public static DocumentResponse of(
            Document document,
            UUID parentId,
            String orderKey,
            boolean hasChildren,
            boolean hasCollaborators,
            DocumentAccessLevel accessLevel,
            OffsetDateTime deletedAt,
            OffsetDateTime purgeAt) {
        return DocumentResponse.withoutBranding(
                document.getId(),
                document.getTitle(),
                null,
                parentId,
                orderKey,
                hasChildren,
                hasCollaborators,
                accessLevel,
                document.getCreatedBy(),
                document.getCreatedAt(),
                document.getUpdatedAt(),
                deletedAt,
                purgeAt,
                DocumentIconCoverMapper.toIconResponse(document),
                DocumentIconCoverMapper.toCoverResponse(document));
    }
}
