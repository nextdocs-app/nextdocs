package com.nextdocs.api.document.service;

import com.nextdocs.api.attachment.AttachmentScope;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.dto.request.DocumentCoverRequest;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentCoverType;
import com.nextdocs.api.pageicon.PageIconType;
import com.nextdocs.api.pageicon.dto.request.PageIconRequest;
import com.nextdocs.api.pageicon.validation.PageIconValidator;
import java.util.Locale;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * Validates page icon and cover assignments and applies them to the document.
 *
 * <p>Icon rules shared with workspaces live in {@link PageIconValidator}, including
 * the upload-reference check; this class owns the document-specific pieces: cover
 * handling and cover position. Uploads reuse the attachment store: the client
 * uploads first, then references the attachment id here, and the validator requires
 * that row to belong to this document and hold browser-renderable raster bytes.
 */
@Component
@RequiredArgsConstructor
public class DocumentIconCoverApplier {

    static final double DEFAULT_COVER_POSITION = 0.5;

    private final PageIconValidator pageIconValidator;

    /** Applies {@code request} to {@code document}; a null request leaves the icon untouched. */
    public void applyIcon(Document document, PageIconRequest request) {
        applyIcon(document, request, false);
    }

    /**
     * Applies {@code request} while creating {@code document}. Upload references
     * are rejected: the document has no id-backed attachments yet, so the client
     * must create the document first, upload the file, then update the icon.
     */
    public void applyIconForCreate(Document document, PageIconRequest request) {
        applyIcon(document, request, true);
    }

    /** Applies {@code request} to {@code document}; a null request leaves the cover untouched. */
    public void applyCover(Document document, DocumentCoverRequest request) {
        applyCover(document, request, false);
    }

    /** Create-path cover assignment; upload references are rejected like {@link #applyIconForCreate}. */
    public void applyCoverForCreate(Document document, DocumentCoverRequest request) {
        applyCover(document, request, true);
    }

    private void applyIcon(Document document, PageIconRequest request, boolean forCreate) {
        if (request == null) {
            return;
        }
        if (request.type() == null || request.type().isBlank()) {
            document.setIconType(null);
            document.setIconValue(null);
            document.setIconColor(null);
            return;
        }
        PageIconType type = PageIconValidator.parseType(request.type());
        if (forCreate && type == PageIconType.UPLOAD) {
            throw new ApiException(
                    ErrorCode.VALIDATION_FAILED,
                    "Icon uploads cannot be referenced while creating a document: "
                            + "create it first, upload the file, then set the icon.");
        }
        String value = switch (type) {
            case EMOJI -> pageIconValidator.validateEmoji(request.value());
            case BUILTIN -> pageIconValidator.validateBuiltin(request.value());
            case UPLOAD ->
                pageIconValidator.validateUpload("Icon", request.value(), AttachmentScope.document(document.getId()));
            case LINK -> PageIconValidator.validateLink("Icon", request.value());
        };
        document.setIconType(type);
        document.setIconValue(value);
        document.setIconColor(PageIconValidator.validateColor(type, request.color()));
    }

    private void applyCover(Document document, DocumentCoverRequest request, boolean forCreate) {
        if (request == null) {
            return;
        }
        if (request.type() == null || request.type().isBlank()) {
            document.setCoverType(null);
            document.setCoverValue(null);
            document.setCoverPosition(null);
            return;
        }
        DocumentCoverType type = parseCoverType(request.type());
        if (forCreate && type == DocumentCoverType.UPLOAD) {
            throw new ApiException(
                    ErrorCode.VALIDATION_FAILED,
                    "Cover uploads cannot be referenced while creating a document: "
                            + "create it first, upload the file, then set the cover.");
        }
        String value = switch (type) {
            case UPLOAD ->
                pageIconValidator.validateUpload("Cover", request.value(), AttachmentScope.document(document.getId()));
            case LINK -> PageIconValidator.validateLink("Cover", request.value());
        };
        // Resolve before mutating: keeping the offset for an unchanged cover
        // reads the current row, which the assignments below would overwrite.
        Double position = resolvePosition(document, type, value, request.position());
        document.setCoverType(type);
        document.setCoverValue(value);
        document.setCoverPosition(position);
    }

    private static DocumentCoverType parseCoverType(String raw) {
        try {
            return DocumentCoverType.valueOf(raw.strip().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException ex) {
            throw new ApiException(
                    ErrorCode.VALIDATION_FAILED, "Unknown cover type: " + PageIconValidator.echo(raw) + ".");
        }
    }

    /**
     * An explicit position wins; otherwise the current offset survives when the cover
     * itself is unchanged, and a new cover starts centered. Clearing is handled by
     * the caller, so this only runs for a set cover.
     */
    private static Double resolvePosition(Document document, DocumentCoverType type, String value, Double requested) {
        if (requested != null) {
            if (!Double.isFinite(requested) || requested < 0 || requested > 1) {
                throw new ApiException(ErrorCode.VALIDATION_FAILED, "Cover position must be between 0 and 1.");
            }
            return requested;
        }
        if (type.equals(document.getCoverType())
                && value.equals(document.getCoverValue())
                && document.getCoverPosition() != null) {
            return document.getCoverPosition();
        }
        return DEFAULT_COVER_POSITION;
    }
}
