package com.nextdocs.api.attachment;

import java.util.Set;

/**
 * Content types the API treats as safely renderable inline in a browser.
 *
 * <p>Single home for the raster-image allowlist so the download headers and
 * the page icon/cover validation cannot drift apart: SVG stays excluded
 * because uploaded SVG is scriptable XML.
 */
public final class AttachmentContentTypes {

    private AttachmentContentTypes() {}

    /** Raster image types a browser renders without executing embedded scripts. */
    public static final Set<String> INLINE_RASTER_IMAGE_TYPES =
            Set.of("image/png", "image/jpeg", "image/gif", "image/webp", "image/avif");

    /**
     * Bytes read to identify a format. PNG/JPEG/GIF/WebP magic all fits in 12, but an
     * ISO-BMFF brand list can carry the {@code avif} brand several entries in, so the
     * window has to cover the ftyp box rather than only its first 32 bytes.
     */
    public static final int SNIFF_BYTES = 128;

    /** The single allowlist message, so a caller cannot leak a different one. */
    public static final String UNSUPPORTED_RASTER_MESSAGE =
            "Unsupported file type: only PNG, JPEG, GIF, WebP, or AVIF images are allowed.";

    /**
     * Detects a browser-renderable raster image from its magic bytes, ignoring
     * any declared label. Returns the detected MIME type, or null when the head
     * does not match PNG, JPEG, GIF, WebP, or AVIF.
     *
     * <p>Shared by the upload path (which stores the detected type) and the page
     * icon/cover validation (which re-sniffs because a stored row may predate
     * sniffing), so the two cannot disagree about what a raster is.
     *
     * <p>This is a head sniff, not a full parse: bytes that begin with a raster
     * signature but carry other content later (a JPEG/HTML polyglot) are classified by
     * that signature. Serving the bytes inertly is what makes that acceptable — the
     * download and glyph responses set {@code X-Content-Type-Options: nosniff} and the
     * {@code default-src 'none'; sandbox} CSP, so a polyglot cannot be reinterpreted as
     * markup. Do not drop either header without revisiting this.
     */
    public static String detectRasterImageType(byte[] head) {
        if (head == null || head.length < 3) {
            return null;
        }
        int b0 = head[0] & 0xFF;
        int b1 = head[1] & 0xFF;
        int b2 = head[2] & 0xFF;
        // PNG: 89 50 4E 47 0D 0A 1A 0A
        if (head.length >= 8
                && b0 == 0x89
                && b1 == 0x50
                && b2 == 0x4E
                && (head[3] & 0xFF) == 0x47
                && (head[4] & 0xFF) == 0x0D
                && (head[5] & 0xFF) == 0x0A
                && (head[6] & 0xFF) == 0x1A
                && (head[7] & 0xFF) == 0x0A) {
            return "image/png";
        }
        // JPEG: FF D8 FF
        if (b0 == 0xFF && b1 == 0xD8 && b2 == 0xFF) {
            return "image/jpeg";
        }
        // GIF: GIF87a / GIF89a
        if (head.length >= 6
                && b0 == 0x47
                && b1 == 0x49
                && b2 == 0x46
                && (head[3] & 0xFF) == 0x38
                && ((head[4] & 0xFF) == 0x37 || (head[4] & 0xFF) == 0x39)
                && (head[5] & 0xFF) == 0x61) {
            return "image/gif";
        }
        // WebP: RIFF....WEBP
        if (head.length >= 12
                && b0 == 0x52
                && b1 == 0x49
                && b2 == 0x46
                && head[3] == 0x46
                && head[8] == 0x57
                && head[9] == 0x45
                && head[10] == 0x42
                && head[11] == 0x50) {
            return "image/webp";
        }
        // AVIF: an ISO-BMFF ftyp box carrying an avif-family brand. MP4 and HEIC
        // share the box type, so the brand has to be present — a bare mif1 (HEIC) or
        // isom (MP4) major brand is never enough on its own. Brands are read at their
        // 4-byte-aligned positions (major brand at 8, minor version at 12, compatible
        // brands from 16) inside the box's declared size: a raw substring match over
        // the head would also read the next box's payload as a brand, and stopping at
        // 32 bytes missed a brand list longer than four entries.
        if (head.length >= 16 && head[4] == 0x66 && head[5] == 0x74 && head[6] == 0x79 && head[7] == 0x70) {
            int boxSize =
                    ((head[0] & 0xFF) << 24) | ((head[1] & 0xFF) << 16) | ((head[2] & 0xFF) << 8) | (head[3] & 0xFF);
            // A box shorter than its own header is malformed; scan what was read instead.
            int end = boxSize >= 16 && boxSize <= head.length ? boxSize : head.length;
            if (isAvifBrand(head, 8)) {
                return "image/avif";
            }
            for (int offset = 16; offset + 4 <= end; offset += 4) {
                if (isAvifBrand(head, offset)) {
                    return "image/avif";
                }
            }
            return null;
        }
        return null;
    }

    /** Whether the four ASCII bytes at {@code offset} spell the {@code avif} or {@code avis} brand. */
    private static boolean isAvifBrand(byte[] head, int offset) {
        return (head[offset] & 0xFF) == 0x61
                && (head[offset + 1] & 0xFF) == 0x76
                && (head[offset + 2] & 0xFF) == 0x69
                && ((head[offset + 3] & 0xFF) == 0x66 || (head[offset + 3] & 0xFF) == 0x73);
    }
}
