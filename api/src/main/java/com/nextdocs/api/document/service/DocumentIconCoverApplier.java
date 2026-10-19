package com.nextdocs.api.document.service;

import com.nextdocs.api.attachment.AttachmentContentTypes;
import com.nextdocs.api.attachment.entity.Attachment;
import com.nextdocs.api.attachment.repository.AttachmentRepository;
import com.nextdocs.api.attachment.storage.AttachmentStorage;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.dto.request.DocumentCoverRequest;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentCoverType;
import com.nextdocs.api.pageicon.PageIconType;
import com.nextdocs.api.pageicon.dto.request.PageIconRequest;
import com.nextdocs.api.pageicon.validation.PageIconValidator;
import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * Validates page icon and cover assignments and applies them to the document.
 *
 * <p>Icon rules shared with workspaces live in {@link PageIconValidator}; this class
 * owns the document-specific pieces: cover handling and the upload-reference check.
 * Uploads reuse the attachment store: the client uploads first, then references
 * the attachment id here. The referenced row must belong to the same document and
 * hold a browser-renderable raster image, so one document cannot borrow another
 * document's files as its icon or cover.
 */
@Component
@RequiredArgsConstructor
public class DocumentIconCoverApplier {

    static final double DEFAULT_COVER_POSITION = 0.5;

    private final AttachmentRepository attachmentRepository;
    private final AttachmentStorage attachmentStorage;
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
        String value =
                switch (type) {
                    case EMOJI -> pageIconValidator.validateEmoji(request.value());
                    case BUILTIN -> pageIconValidator.validateBuiltin(request.value());
                    case UPLOAD -> validateUpload("Icon", request.value(), document.getId());
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
        String value =
                switch (type) {
                    case UPLOAD -> validateUpload("Cover", request.value(), document.getId());
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

    private String validateUpload(String field, String raw, UUID documentId) {
        String value = raw == null ? "" : raw.strip();
        UUID attachmentId;
        try {
            attachmentId = UUID.fromString(value);
        } catch (IllegalArgumentException ex) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, field + " upload must reference an attachment id.");
        }
        Attachment attachment = attachmentRepository
                .findById(attachmentId)
                .orElseThrow(() -> new ApiException(ErrorCode.VALIDATION_FAILED, "Referenced upload was not found."));
        if (!attachment.getDocument().getId().equals(documentId)) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Referenced upload does not belong to this document.");
        }
        String contentType = attachment.getContentType();
        if (contentType == null
                || !AttachmentContentTypes.INLINE_RASTER_IMAGE_TYPES.contains(contentType.toLowerCase(Locale.ROOT))) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, rasterTypeError(field));
        }
        verifyStoredBytes(field, attachment);
        return attachmentId.toString();
    }

    /**
     * Re-sniffs the stored head instead of trusting the row's content type.
     *
     * <p>A row can carry a raster label over non-raster bytes — uploaded before
     * uploads sniffed their bytes, or written by an older deployment — and the
     * icon/cover URL is rendered by the browser, so the bytes have to be what
     * decides. The label check above stays as the cheap first cut and keeps the
     * type wording; this one is what makes the guarantee true for existing rows.
     */
    private void verifyStoredBytes(String field, Attachment attachment) {
        byte[] head;
        try (InputStream stored =
                attachmentStorage.open(attachment.getStorageKey()).resource().getInputStream()) {
            head = stored.readNBytes(AttachmentContentTypes.SNIFF_BYTES);
        } catch (IOException | RuntimeException ex) {
            // A row whose bytes are missing or unreadable cannot back an icon: the
            // storage layer raises a 404-style error for an absent file.
            throw new ApiException(ErrorCode.VALIDATION_FAILED, rasterTypeError(field));
        }
        if (AttachmentContentTypes.detectRasterImageType(head) == null) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, rasterTypeError(field));
        }
    }

    private static String rasterTypeError(String field) {
        return field + " uploads must be PNG, JPEG, GIF, WebP, or AVIF images.";
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
