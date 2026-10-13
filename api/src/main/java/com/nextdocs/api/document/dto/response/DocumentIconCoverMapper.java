package com.nextdocs.api.document.dto.response;

import com.nextdocs.api.document.entity.Document;
import java.util.Locale;

/**
 * Maps the page icon and cover columns to their DTOs. Every {@link DocumentResponse}
 * construction site funnels through here so the enum-to-wire mapping lives in one place.
 */
public final class DocumentIconCoverMapper {

    private DocumentIconCoverMapper() {}

    /** Page icon DTO, or null when the document has none. */
    public static DocumentIconResponse toIconResponse(Document document) {
        if (document.getIconType() == null) {
            return null;
        }
        return new DocumentIconResponse(
                document.getIconType().name().toLowerCase(Locale.ROOT),
                document.getIconValue(),
                document.getIconColor());
    }

    /** Cover DTO, or null when the document has none. */
    public static DocumentCoverResponse toCoverResponse(Document document) {
        if (document.getCoverType() == null) {
            return null;
        }
        return new DocumentCoverResponse(
                document.getCoverType().name().toLowerCase(Locale.ROOT),
                document.getCoverValue(),
                document.getCoverPosition());
    }
}
