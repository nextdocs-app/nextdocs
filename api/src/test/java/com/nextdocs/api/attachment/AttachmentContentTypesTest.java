package com.nextdocs.api.attachment;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

/**
 * Magic-byte sniffing, shared by the upload path (which stores the detected type) and
 * the page icon/cover validation (which re-sniffs an existing row).
 */
class AttachmentContentTypesTest {

    @Test
    void detectRasterImageType_acceptsEachAllowedFormat() {
        assertEquals("image/png", AttachmentContentTypes.detectRasterImageType(new byte[] {
            (byte) 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00
        }));
        assertEquals(
                "image/jpeg",
                AttachmentContentTypes.detectRasterImageType(new byte[] {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF}));
        assertEquals(
                "image/gif",
                AttachmentContentTypes.detectRasterImageType("GIF89a".getBytes(StandardCharsets.US_ASCII)));
        assertEquals("image/webp", AttachmentContentTypes.detectRasterImageType(new byte[] {
            0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50
        }));
        assertEquals("image/avif", AttachmentContentTypes.detectRasterImageType(new byte[] {
            0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0x00, 0x00, 0x00, 0x00
        }));
    }

    @Test
    void detectRasterImageType_rejectsImpostorsAndTruncatedHeads() {
        // MP4 (isom) and HEIC (mif1+heic, no avif brand) share the ftyp box but are not AVIF.
        assertNull(AttachmentContentTypes.detectRasterImageType(new byte[] {
            0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6F, 0x6D, 0x00, 0x00, 0x00, 0x00
        }));
        assertNull(AttachmentContentTypes.detectRasterImageType(new byte[] {
            0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x6D, 0x69, 0x66, 0x31, 0x68, 0x65, 0x69, 0x63
        }));
        assertNull(AttachmentContentTypes.detectRasterImageType(new byte[] {0x3C, 0x73, 0x76, 0x67}));
        assertNull(AttachmentContentTypes.detectRasterImageType(new byte[] {0x00}));
        assertNull(AttachmentContentTypes.detectRasterImageType(null));
    }

    @Test
    void detectRasterImageType_readsBrandsPastTheOldSniffWindow() {
        // A real AVIF whose brand list is longer than four entries: "avif" sits at
        // offset 40, outside the previous 32-byte window.
        assertEquals(
                "image/avif",
                AttachmentContentTypes.detectRasterImageType(
                        ftypHead(60, 60, "mif1", "miaf", "MA1B", "mif1", "miaf", "isom", "mp41", "avif")));
    }

    @Test
    void detectRasterImageType_ignoresBrandTextOutsideTheFtypBox() {
        // The box declares 16 bytes, so the "avif" bytes after it are payload: a raw
        // substring match over the head would have classified an MP4 as AVIF.
        byte[] head = ftypHead(32, 16, "isom");
        writeBrand(head, 16, "avif");

        assertNull(AttachmentContentTypes.detectRasterImageType(head));
    }

    /**
     * An ISO-BMFF head padded to {@code length}: a {@code boxSize}-byte ftyp box with the
     * major brand at offset 8 (the minor version at 12 stays zero) and compatible brands
     * from offset 16.
     */
    private static byte[] ftypHead(int length, int boxSize, String majorBrand, String... compatibleBrands) {
        byte[] head = new byte[length];
        head[0] = (byte) ((boxSize >>> 24) & 0xFF);
        head[1] = (byte) ((boxSize >>> 16) & 0xFF);
        head[2] = (byte) ((boxSize >>> 8) & 0xFF);
        head[3] = (byte) (boxSize & 0xFF);
        head[4] = 'f';
        head[5] = 't';
        head[6] = 'y';
        head[7] = 'p';
        writeBrand(head, 8, majorBrand);
        int offset = 16;
        for (String brand : compatibleBrands) {
            writeBrand(head, offset, brand);
            offset += 4;
        }
        return head;
    }

    private static void writeBrand(byte[] head, int offset, String brand) {
        System.arraycopy(brand.getBytes(StandardCharsets.US_ASCII), 0, head, offset, 4);
    }
}
