package com.nextdocs.api.pageicon.validation;

import com.nextdocs.api.attachment.AttachmentContentTypes;
import com.nextdocs.api.attachment.AttachmentScope;
import com.nextdocs.api.attachment.entity.Attachment;
import com.nextdocs.api.attachment.repository.AttachmentRepository;
import com.nextdocs.api.attachment.storage.AttachmentStorage;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.validation.IconCatalog;
import com.nextdocs.api.document.validation.IconSlugs;
import com.nextdocs.api.pageicon.PageIconType;
import com.nextdocs.api.pageicon.dto.request.PageIconRequest;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * Validation rules shared by every page icon (documents, workspaces): one emoji
 * grapheme, a catalogued builtin slug, an https image link, an upload reference
 * that belongs to the target scope, and the builtin-only color palette. Callers
 * orchestrate which sources they accept and how the result is stored; this class
 * owns what a valid value looks like.
 */
@Component
@RequiredArgsConstructor
public class PageIconValidator {

    static final int MAX_VALUE_LENGTH = 2048;
    static final int MAX_ERROR_ECHO_LENGTH = 64;

    /** Zero-width joiner: binds the following code point into the current cluster. */
    private static final int ZERO_WIDTH_JOINER = 0x200D;

    /** Regional-indicator block; two in a row form a single flag cluster. */
    private static final int REGIONAL_INDICATOR_START = 0x1F1E6;

    private static final int REGIONAL_INDICATOR_END = 0x1F1FF;

    /**
     * Bidirectional controls that can visually reorder a rendered icon:
     * harmless in storage, a spoofing aid when rendered as text.
     */
    private static final Set<Integer> BIDI_CONTROLS =
            Set.of(0x200E, 0x200F, 0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2066, 0x2067, 0x2068, 0x2069, 0x061C);

    /**
     * Invisible zero-width format characters, none of which can be part of a visible
     * glyph. Unlike the bidi controls above they reorder nothing; the reason to reject
     * them is that an icon is exactly one emoji, and a format character placed directly
     * after a joiner is folded into the preceding cluster, so the grapheme count alone
     * accepts a value holding extra invisible content.
     *
     * <p>ZWJ is deliberately absent: a ZWJ sequence is one emoji, not smuggled content.
     */
    private static final Set<Integer> INVISIBLE_FORMAT_CONTROLS =
            Set.of(0x00AD, 0x200B, 0x200C, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xFEFF);

    public static final Set<String> ALLOWED_ICON_COLORS =
            Set.of("default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red");

    private final IconCatalog iconCatalog;
    private final AttachmentRepository attachmentRepository;
    private final AttachmentStorage attachmentStorage;

    /** A request field set after all source-specific rules (and upload bytes) passed. */
    public record ValidatedIcon(PageIconType type, String value, String color) {}

    /**
     * Validates a whole icon request, including reading and sniffing upload bytes. Callers
     * that mutate under a database lock should run this first, then re-check the upload
     * reference under the lock with {@link #validateUploadReference}.
     */
    public ValidatedIcon validateIcon(PageIconRequest request, AttachmentScope scope) {
        if (request.type() == null || request.type().isBlank()) {
            return new ValidatedIcon(null, null, null);
        }
        PageIconType type = parseType(request.type());
        String value = switch (type) {
            case EMOJI -> validateEmoji(request.value());
            case BUILTIN -> validateBuiltin(request.value());
            case LINK -> validateLink("Icon", request.value());
            case UPLOAD -> validateUpload("Icon", request.value(), scope);
        };
        return new ValidatedIcon(type, value, validateColor(type, request.color()));
    }

    /**
     * Validates an icon for a space. Uploads are rejected rather than silently unsupported:
     * an uploaded icon must belong to an attachment scope, and spaces do not own attachments
     * yet (a space upload would have nowhere to be scoped, swept, or quota-counted).
     */
    public ValidatedIcon validateSpaceIcon(PageIconRequest request) {
        if (request == null) {
            return null;
        }
        if (request.type() != null && !request.type().isBlank() && parseType(request.type()) == PageIconType.UPLOAD) {
            throw new ApiException(
                    ErrorCode.VALIDATION_FAILED, "Space icons must be an emoji, a builtin icon, or an https link.");
        }
        return validateIcon(request, null);
    }

    /** Parses a case-insensitive icon source name; unknown values are a validation error. */
    public static PageIconType parseType(String raw) {
        try {
            return PageIconType.valueOf(raw.strip().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException ex) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Unknown icon type: " + echo(raw) + ".");
        }
    }

    public String validateEmoji(String raw) {
        String value = raw == null ? "" : raw.strip();
        if (value.isEmpty()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Emoji icon must not be empty.");
        }
        // Bound the stored value: the column is VARCHAR(2048), and one cluster
        // alone can be long (a base glyph plus any number of combining marks).
        // Measured in UTF-16 units on purpose — that is what the column counts.
        if (value.length() > MAX_VALUE_LENGTH) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Emoji icon must be a single emoji.");
        }
        if (value.codePoints().anyMatch(cp -> Character.isISOControl(cp))
                || containsBidiControl(value)
                || containsInvisibleFormatControl(value)) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Emoji icon must be a single emoji.");
        }
        // "One emoji" is one grapheme cluster, not a code-point budget: a budget
        // contradicts the message below in both directions — sixteen 😀 passed as
        // "a single emoji" while a lone base glyph carrying combining marks was
        // rejected for being too long. Counting clusters is what a reader sees;
        // a code-point flood simply counts as many clusters and fails.
        if (countGraphemeClusters(value) != 1) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Emoji icon must be a single emoji.");
        }
        // Plain prose is not an icon: require at least one pictographic code
        // point (symbol or supplementary-plane glyph). Joiners and variation
        // selectors may accompany it but never suffice on their own. Keycap
        // sequences (1️⃣, #️⃣) have no pictographic base — digit/#/* plus
        // U+20E3 — so the combining keycap explicitly counts.
        boolean pictographic = value.codePoints().anyMatch(PageIconValidator::isPictographic);
        if (!pictographic) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Emoji icon must be a single emoji.");
        }
        return value;
    }

    /**
     * Counts the extended grapheme clusters a reader sees as emoji.
     *
     * <p>Combining marks, variation selectors, and skin-tone modifiers extend the
     * cluster they follow; a zero-width joiner binds a following pictograph into
     * the same cluster (a ZWJ family is one emoji, not several); and two regional
     * indicators in a row are one flag. Java exposes no UAX #29 breaker, so the
     * subset that matters for an icon is spelled out here. Anything unhandled
     * starts a new cluster, which fails the single-cluster rule rather than
     * sneaking past it.
     */
    private static int countGraphemeClusters(String value) {
        int clusters = 0;
        boolean afterJoiner = false;
        boolean afterRegionalIndicator = false;
        for (int index = 0; index < value.length(); ) {
            int codePoint = value.codePointAt(index);
            index += Character.charCount(codePoint);
            if (codePoint == ZERO_WIDTH_JOINER) {
                afterJoiner = true;
                continue;
            }
            if (isClusterExtender(codePoint)) {
                // GB9 glues an extender, but it also spends the join: GB11 joins
                // only a pictograph that follows the joiner directly, so an
                // extender in between leaves the two glyphs separate.
                afterJoiner = false;
                continue;
            }
            if (codePoint >= REGIONAL_INDICATOR_START && codePoint <= REGIONAL_INDICATOR_END) {
                if (afterRegionalIndicator) {
                    afterRegionalIndicator = false;
                    continue;
                }
                clusters++;
                afterRegionalIndicator = true;
                afterJoiner = false;
                continue;
            }
            afterRegionalIndicator = false;
            if (afterJoiner) {
                afterJoiner = false;
                // GB11: a joiner folds a following pictograph into the cluster
                // before it. Any other code point starts a new cluster, which is
                // what makes "😀\u200Da" two glyphs instead of one.
                if (isPictographic(codePoint)) {
                    continue;
                }
            }
            clusters++;
        }
        return clusters;
    }

    /** Marks, variation selectors, and skin-tone modifiers extend the cluster they follow. */
    private static boolean isClusterExtender(int codePoint) {
        if (codePoint >= 0xFE00 && codePoint <= 0xFE0F) {
            return true; // variation selectors
        }
        if (codePoint >= 0xE0100 && codePoint <= 0xE01EF) {
            return true; // variation selectors supplement
        }
        if (codePoint >= 0x1F3FB && codePoint <= 0x1F3FF) {
            return true; // emoji modifier (skin tones)
        }
        int type = Character.getType(codePoint);
        return type == Character.NON_SPACING_MARK
                || type == Character.COMBINING_SPACING_MARK
                || type == Character.ENCLOSING_MARK;
    }

    /**
     * Whether {@code codePoint} is a pictograph: a symbol, a supplementary-plane
     * glyph, or the keycap combiner (which carries no pictographic base of its
     * own). One home for the predicate, so "this icon has a pictograph" and "this
     * joiner actually joins" cannot disagree.
     */
    private static boolean isPictographic(int codePoint) {
        return codePoint >= 0x1D000
                || codePoint == 0x20E3
                || Character.getType(codePoint) == Character.OTHER_SYMBOL
                || Character.getType(codePoint) == Character.MODIFIER_SYMBOL;
    }

    private static boolean containsBidiControl(String value) {
        return value.codePoints().anyMatch(BIDI_CONTROLS::contains);
    }

    private static boolean containsInvisibleFormatControl(String value) {
        return value.codePoints().anyMatch(INVISIBLE_FORMAT_CONTROLS::contains);
    }

    public String validateBuiltin(String raw) {
        String value = raw == null ? "" : raw.strip();
        if (!IconSlugs.isWellFormed(value) || !iconCatalog.isValidSlug(value)) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Unknown builtin icon: " + echo(raw) + ".");
        }
        return value;
    }

    /**
     * Validates an upload reference and its stored bytes, returning the canonical
     * attachment id. See {@link #validateUploadReference} for the row checks; this adds
     * the re-sniff of the file, which does storage I/O and must stay outside a database
     * lock.
     */
    public String validateUpload(String field, String raw, AttachmentScope scope) {
        Attachment attachment = validateUploadReference(field, raw, scope);
        verifyStoredBytes(field, attachment);
        return attachment.getId().toString();
    }

    /**
     * Validates an upload reference without touching storage: the row must exist, belong
     * to {@code scope}, and carry a raster content type. Its bytes are re-sniffed by
     * {@link #validateUpload}; callers that already did that outside a lock re-run this
     * cheap check under the lock so a deleted or re-scoped row cannot be adopted.
     */
    public Attachment validateUploadReference(String field, String raw, AttachmentScope scope) {
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
        if (!attachment.scope().equals(scope)) {
            throw new ApiException(
                    ErrorCode.VALIDATION_FAILED, "Referenced upload does not belong to this " + scopeNoun(scope) + ".");
        }
        String contentType = attachment.getContentType();
        if (contentType == null
                || !AttachmentContentTypes.INLINE_RASTER_IMAGE_TYPES.contains(contentType.toLowerCase(Locale.ROOT))) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, rasterTypeError(field));
        }
        return attachment;
    }

    private static String scopeNoun(AttachmentScope scope) {
        return scope.kind() == AttachmentScope.Kind.DOCUMENT ? "document" : "workspace";
    }

    /**
     * Re-sniffs the stored head instead of trusting the row's content type.
     *
     * <p>A row can carry a raster label over non-raster bytes — uploaded before
     * uploads sniffed their bytes, or written by an older deployment — and the
     * icon/cover URL is rendered by the browser, so the bytes have to be what
     * decides. The label check is the cheap first cut and keeps the type wording;
     * this one is what makes the guarantee true for existing rows.
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

    /** Strips the color and normalizes the literal "default" to null (the stored form). */
    public static String validateColor(PageIconType type, String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String color = raw.strip().toLowerCase(Locale.ROOT);
        if (!ALLOWED_ICON_COLORS.contains(color)) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Unknown icon color: " + echo(raw) + ".");
        }
        if (type != PageIconType.BUILTIN) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Icon color is only allowed on builtin icons.");
        }
        return "default".equals(color) ? null : color;
    }

    /**
     * Validates an https image link. The server never fetches the URL (no SSRF
     * surface); it is stored and rendered by clients, which must load it in an
     * <img> with referrerpolicy=no-referrer — never as markup — so a hostile host
     * can neither run script nor learn more than that the image was viewed.
     */
    public static String validateLink(String field, String raw) {
        String value = raw == null ? "" : raw.strip();
        if (value.isEmpty() || value.length() > MAX_VALUE_LENGTH) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, field + " link must be 1-2048 characters.");
        }
        URI uri;
        try {
            uri = new URI(value);
        } catch (Exception ex) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, field + " link must be a valid URL.");
        }
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, field + " link must be an https URL.");
        }
        return value;
    }

    /** Caps echoed input in errors so a hostile value cannot bloat the response. */
    public static String echo(String raw) {
        String value = raw == null ? "" : raw.strip();
        return value.length() <= MAX_ERROR_ECHO_LENGTH ? value : value.substring(0, MAX_ERROR_ECHO_LENGTH) + "…";
    }
}
