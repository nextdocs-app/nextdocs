package com.nextdocs.api.document.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.when;

import com.nextdocs.api.attachment.entity.Attachment;
import com.nextdocs.api.attachment.repository.AttachmentRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.dto.request.DocumentCoverRequest;
import com.nextdocs.api.document.dto.request.DocumentIconRequest;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentCoverType;
import com.nextdocs.api.document.entity.DocumentIconType;
import com.nextdocs.api.document.validation.IconCatalog;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class DocumentIconCoverApplierTest {

    @Mock
    private AttachmentRepository attachmentRepository;

    @Mock
    private IconCatalog iconCatalog;

    private DocumentIconCoverApplier applier;
    private Document document;
    private UUID documentId;

    @BeforeEach
    void setUp() {
        applier = new DocumentIconCoverApplier(attachmentRepository, iconCatalog);
        documentId = UUID.randomUUID();
        document = Document.builder().id(documentId).title("Doc").build();
    }

    @Test
    void applyIcon_nullRequest_leavesUntouched() {
        document.setIconType(DocumentIconType.EMOJI);
        document.setIconValue("📝");

        applier.applyIcon(document, null);

        assertEquals(DocumentIconType.EMOJI, document.getIconType());
        assertEquals("📝", document.getIconValue());
    }

    @Test
    void applyIcon_nullType_clears() {
        document.setIconType(DocumentIconType.EMOJI);
        document.setIconValue("📝");

        applier.applyIcon(document, new DocumentIconRequest(null, "📝"));

        assertNull(document.getIconType());
        assertNull(document.getIconValue());
    }

    @Test
    void applyIcon_emoji_acceptsSingleGrapheme() {
        applier.applyIcon(document, new DocumentIconRequest("emoji", "📝"));

        assertEquals(DocumentIconType.EMOJI, document.getIconType());
        assertEquals("📝", document.getIconValue());
    }

    @Test
    void applyIcon_emoji_acceptsMultiCodePointSequence() {
        // Family emoji is one grapheme but seven code points: length caps must allow it.
        applier.applyIcon(document, new DocumentIconRequest("EMOJI", "👨‍👩‍👧‍👦"));

        assertEquals(DocumentIconType.EMOJI, document.getIconType());
    }

    @Test
    void applyIcon_emoji_rejectsEmptyAndPlainText() {
        assertThrows(ApiException.class, () -> applier.applyIcon(document, new DocumentIconRequest("EMOJI", "  ")));
        assertThrows(
                ApiException.class,
                () -> applier.applyIcon(document, new DocumentIconRequest("EMOJI", "a".repeat(17))));
    }

    @Test
    void applyIcon_emoji_rejectsMoreThanOneEmoji() {
        // The reviewed counterexample: sixteen separate 😀 fit inside a 16-code-point
        // budget and passed as "a single emoji".
        assertThrows(
                ApiException.class,
                () -> applier.applyIcon(document, new DocumentIconRequest("EMOJI", "😀".repeat(16))));
        assertThrows(ApiException.class, () -> applier.applyIcon(document, new DocumentIconRequest("EMOJI", "😀🚀")));
        assertThrows(
                ApiException.class, () -> applier.applyIcon(document, new DocumentIconRequest("EMOJI", "🇺🇸🇨🇦")));
    }

    @Test
    void applyIcon_emoji_acceptsOneClusterLongerThanTheOldBudget() {
        // One cluster in 21 code points: a base glyph plus combining marks, which
        // the code-point budget rejected even though it is a single emoji.
        String decorated = "😀" + "\u0301".repeat(20);

        applier.applyIcon(document, new DocumentIconRequest("EMOJI", decorated));

        assertEquals(DocumentIconType.EMOJI, document.getIconType());
        assertEquals(decorated, document.getIconValue());
    }

    @Test
    void applyIcon_emoji_rejectsAClusterPastTheStorageCap() {
        // Still one cluster, but past VARCHAR(2048): the storage bound is a real
        // limit rather than the dead arm of the old code-point disjunct.
        String oversized = "😀" + "\u0301".repeat(2100);

        assertThrows(
                ApiException.class, () -> applier.applyIcon(document, new DocumentIconRequest("EMOJI", oversized)));
    }

    @Test
    void applyIcon_unknownType_rejected() {
        ApiException ex = assertThrows(
                ApiException.class, () -> applier.applyIcon(document, new DocumentIconRequest("TABLER", "home")));
        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
    }

    @Test
    void applyIcon_builtin_acceptsCataloguedSlug() {
        when(iconCatalog.isValidSlug("home")).thenReturn(true);

        applier.applyIcon(document, new DocumentIconRequest("builtin", "home"));

        assertEquals(DocumentIconType.BUILTIN, document.getIconType());
        assertEquals("home", document.getIconValue());
    }

    @Test
    void applyIcon_builtin_rejectsUnknownSlug() {
        when(iconCatalog.isValidSlug("nope")).thenReturn(false);

        ApiException ex = assertThrows(
                ApiException.class, () -> applier.applyIcon(document, new DocumentIconRequest("BUILTIN", "nope")));
        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
    }

    @Test
    void applyIcon_builtin_rejectsTraversal() {
        ApiException ex = assertThrows(
                ApiException.class, () -> applier.applyIcon(document, new DocumentIconRequest("BUILTIN", "../secret")));
        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
    }

    @Test
    void applyIcon_upload_acceptsOwnedRasterImage() {
        UUID attachmentId = UUID.randomUUID();
        when(attachmentRepository.findById(attachmentId)).thenReturn(Optional.of(attachment(documentId, "image/png")));

        applier.applyIcon(document, new DocumentIconRequest("UPLOAD", attachmentId.toString()));

        assertEquals(DocumentIconType.UPLOAD, document.getIconType());
        assertEquals(attachmentId.toString(), document.getIconValue());
    }

    @Test
    void applyIcon_upload_rejectsMissingRow() {
        UUID attachmentId = UUID.randomUUID();
        when(attachmentRepository.findById(attachmentId)).thenReturn(Optional.empty());

        ApiException ex = assertThrows(
                ApiException.class,
                () -> applier.applyIcon(document, new DocumentIconRequest("UPLOAD", attachmentId.toString())));
        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
    }

    @Test
    void applyIcon_upload_rejectsForeignDocumentFile() {
        UUID attachmentId = UUID.randomUUID();
        when(attachmentRepository.findById(attachmentId))
                .thenReturn(Optional.of(attachment(UUID.randomUUID(), "image/png")));

        ApiException ex = assertThrows(
                ApiException.class,
                () -> applier.applyIcon(document, new DocumentIconRequest("UPLOAD", attachmentId.toString())));
        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
    }

    @Test
    void applyIcon_upload_rejectsNonRasterContent() {
        UUID pdfId = UUID.randomUUID();
        UUID svgId = UUID.randomUUID();
        when(attachmentRepository.findById(pdfId)).thenReturn(Optional.of(attachment(documentId, "application/pdf")));
        when(attachmentRepository.findById(svgId)).thenReturn(Optional.of(attachment(documentId, "image/svg+xml")));

        // Uploaded SVG stays rejected: it is scriptable XML, unlike a remote <img> reference.
        assertThrows(
                ApiException.class,
                () -> applier.applyIcon(document, new DocumentIconRequest("UPLOAD", pdfId.toString())));
        assertThrows(
                ApiException.class,
                () -> applier.applyIcon(document, new DocumentIconRequest("UPLOAD", svgId.toString())));
    }

    @Test
    void applyIcon_upload_rejectsNonUuid() {
        ApiException ex = assertThrows(
                ApiException.class, () -> applier.applyIcon(document, new DocumentIconRequest("UPLOAD", "not-a-uuid")));
        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
    }

    @Test
    void applyIcon_link_acceptsHttps() {
        applier.applyIcon(document, new DocumentIconRequest("LINK", "https://example.com/icon.png"));

        assertEquals(DocumentIconType.LINK, document.getIconType());
        assertEquals("https://example.com/icon.png", document.getIconValue());
    }

    @Test
    void applyIcon_link_rejectsHttpAndMalformed() {
        assertThrows(
                ApiException.class,
                () -> applier.applyIcon(document, new DocumentIconRequest("LINK", "http://example.com/i.png")));
        assertThrows(
                ApiException.class, () -> applier.applyIcon(document, new DocumentIconRequest("LINK", "not a url")));
        assertThrows(ApiException.class, () -> applier.applyIcon(document, new DocumentIconRequest("LINK", "  ")));
    }

    @Test
    void applyCover_nullRequest_leavesUntouched() {
        document.setCoverType(DocumentCoverType.LINK);
        document.setCoverValue("https://example.com/c.png");
        document.setCoverPosition(0.2);

        applier.applyCover(document, null);

        assertEquals(DocumentCoverType.LINK, document.getCoverType());
        assertEquals(0.2, document.getCoverPosition());
    }

    @Test
    void applyCover_nullType_clearsAll() {
        document.setCoverType(DocumentCoverType.LINK);
        document.setCoverValue("https://example.com/c.png");
        document.setCoverPosition(0.2);

        applier.applyCover(document, new DocumentCoverRequest(null, null, 0.9));

        assertNull(document.getCoverType());
        assertNull(document.getCoverValue());
        assertNull(document.getCoverPosition());
    }

    @Test
    void applyCover_link_defaultsPositionToCenter() {
        applier.applyCover(document, new DocumentCoverRequest("link", "https://example.com/c.png", null));

        assertEquals(DocumentCoverType.LINK, document.getCoverType());
        assertEquals(0.5, document.getCoverPosition());
    }

    @Test
    void applyCover_explicitPosition_accepted() {
        applier.applyCover(document, new DocumentCoverRequest("LINK", "https://example.com/c.png", 0.0));

        assertEquals(0.0, document.getCoverPosition());
    }

    @Test
    void applyCover_positionOutOfRange_rejected() {
        assertThrows(
                ApiException.class,
                () -> applier.applyCover(document, new DocumentCoverRequest("LINK", "https://example.com/c.png", 1.1)));
        assertThrows(
                ApiException.class,
                () -> applier.applyCover(
                        document, new DocumentCoverRequest("LINK", "https://example.com/c.png", -0.1)));
        assertThrows(
                ApiException.class,
                () -> applier.applyCover(
                        document, new DocumentCoverRequest("LINK", "https://example.com/c.png", Double.NaN)));
    }

    @Test
    void applyCover_sameCoverWithoutPosition_keepsOffset() {
        document.setCoverType(DocumentCoverType.LINK);
        document.setCoverValue("https://example.com/c.png");
        document.setCoverPosition(0.2);

        applier.applyCover(document, new DocumentCoverRequest("LINK", "https://example.com/c.png", null));

        assertEquals(0.2, document.getCoverPosition());
    }

    @Test
    void applyCover_newCoverWithoutPosition_resetsToCenter() {
        document.setCoverType(DocumentCoverType.LINK);
        document.setCoverValue("https://example.com/old.png");
        document.setCoverPosition(0.2);

        applier.applyCover(document, new DocumentCoverRequest("LINK", "https://example.com/new.png", null));

        assertEquals(0.5, document.getCoverPosition());
    }

    @Test
    void applyCover_emojiType_rejected() {
        ApiException ex = assertThrows(
                ApiException.class, () -> applier.applyCover(document, new DocumentCoverRequest("EMOJI", "📝", null)));
        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
    }

    @Test
    void applyCover_upload_acceptsOwnedGif() {
        UUID attachmentId = UUID.randomUUID();
        when(attachmentRepository.findById(attachmentId)).thenReturn(Optional.of(attachment(documentId, "image/gif")));

        applier.applyCover(document, new DocumentCoverRequest("UPLOAD", attachmentId.toString(), null));

        assertEquals(DocumentCoverType.UPLOAD, document.getCoverType());
        assertEquals(0.5, document.getCoverPosition());
    }

    @Test
    void applyIcon_emoji_rejectsPlainText() {
        assertThrows(ApiException.class, () -> applier.applyIcon(document, new DocumentIconRequest("EMOJI", "hello")));
        assertThrows(ApiException.class, () -> applier.applyIcon(document, new DocumentIconRequest("EMOJI", "A")));
        assertThrows(ApiException.class, () -> applier.applyIcon(document, new DocumentIconRequest("EMOJI", "1")));
    }

    @Test
    void applyIcon_emoji_acceptsKeycapAndFlags() {
        applier.applyIcon(document, new DocumentIconRequest("EMOJI", "1️⃣"));
        assertEquals(DocumentIconType.EMOJI, document.getIconType());

        applier.applyIcon(document, new DocumentIconRequest("EMOJI", "🇺🇸"));
        assertEquals(DocumentIconType.EMOJI, document.getIconType());

        applier.applyIcon(document, new DocumentIconRequest("EMOJI", "👨‍👩‍👧‍👦"));
        assertEquals(DocumentIconType.EMOJI, document.getIconType());
    }

    @Test
    void applyIcon_emoji_rejectsJoinerThatJoinsNoPictograph() {
        // UAX #29 joins only a pictograph to the cluster before the joiner, so each of
        // these is two glyphs — the count used to fold whatever followed the joiner into
        // the preceding cluster and store them as a one-emoji icon.
        assertThrows(
                ApiException.class, () -> applier.applyIcon(document, new DocumentIconRequest("EMOJI", "😀\u200Da")));
        assertThrows(
                ApiException.class, () -> applier.applyIcon(document, new DocumentIconRequest("EMOJI", "😀\u200D#")));
        // An extender between the joiner and the pictograph spends the join.
        assertThrows(
                ApiException.class,
                () -> applier.applyIcon(document, new DocumentIconRequest("EMOJI", "😀\u200D\u0301😀")));
    }

    @Test
    void applyIcon_emoji_acceptsPictographsJoinedAcrossExtenders() {
        // The sequences this rule exists for: a skin tone or variation selector on
        // either side of the joiner never spends it.
        for (String joined : new String[] {"👋🏽\u200D♀️", "🫱🏽\u200D🫲🏻", "👨\u200D👩\u200D👧"}) {
            applier.applyIcon(document, new DocumentIconRequest("EMOJI", joined));
            assertEquals(DocumentIconType.EMOJI, document.getIconType());
        }
    }

    @Test
    void applyIcon_emoji_rejectsBidiControls() {
        assertThrows(
                ApiException.class, () -> applier.applyIcon(document, new DocumentIconRequest("EMOJI", "📝\u202A")));
    }

    @Test
    void applyIcon_emoji_rejectsInvisibleFormatControls() {
        // Each sits directly after a joiner, where the cluster rule folds it into the
        // preceding cluster: all four were stored as a one-emoji icon before this check.
        assertThrows(
                ApiException.class,
                () -> applier.applyIcon(document, new DocumentIconRequest("EMOJI", "👨\u200D\u200B")));
        assertThrows(
                ApiException.class,
                () -> applier.applyIcon(document, new DocumentIconRequest("EMOJI", "👨\u200D\uFEFF")));
        assertThrows(
                ApiException.class,
                () -> applier.applyIcon(document, new DocumentIconRequest("EMOJI", "👨\u200D\u2060")));
        assertThrows(
                ApiException.class,
                () -> applier.applyIcon(document, new DocumentIconRequest("EMOJI", "👨\u200D\u00AD")));
        assertThrows(
                ApiException.class,
                () -> applier.applyIcon(document, new DocumentIconRequest("EMOJI", "😀\u200D\u200C")));
        assertThrows(
                ApiException.class,
                () -> applier.applyIcon(document, new DocumentIconRequest("EMOJI", "😀\u200D\u2063")));
    }

    @Test
    void applyIcon_type_isTrimmedAndCaseInsensitive() {
        when(iconCatalog.isValidSlug("home")).thenReturn(true);

        applier.applyIcon(document, new DocumentIconRequest("  BuIlTiN  ", "home"));

        assertEquals(DocumentIconType.BUILTIN, document.getIconType());
    }

    @Test
    void applyIcon_link_rejectsUserInfo() {
        ApiException ex = assertThrows(
                ApiException.class,
                () -> applier.applyIcon(
                        document, new DocumentIconRequest("LINK", "https://user:pass@example.com/i.png")));
        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
    }

    @Test
    void applyCover_position_acceptsBoundariesAndRejectsInfinity() {
        applier.applyCover(document, new DocumentCoverRequest("LINK", "https://example.com/c.png", 1.0));
        assertEquals(1.0, document.getCoverPosition());

        assertThrows(
                ApiException.class,
                () -> applier.applyCover(
                        document,
                        new DocumentCoverRequest("LINK", "https://example.com/c.png", Double.POSITIVE_INFINITY)));
    }

    @Test
    void applyIconForCreate_rejectsUploadReference() {
        ApiException ex = assertThrows(
                ApiException.class,
                () -> applier.applyIconForCreate(
                        document,
                        new DocumentIconRequest("UPLOAD", UUID.randomUUID().toString())));
        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
        assertNull(document.getIconType());
    }

    @Test
    void applyCoverForCreate_rejectsUploadReference() {
        ApiException ex = assertThrows(
                ApiException.class,
                () -> applier.applyCoverForCreate(
                        document,
                        new DocumentCoverRequest("UPLOAD", UUID.randomUUID().toString(), null)));
        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
        assertNull(document.getCoverType());
    }

    @Test
    void applyIconForCreate_acceptsEmojiAndLink() {
        applier.applyIconForCreate(document, new DocumentIconRequest("EMOJI", "📝"));
        assertEquals(DocumentIconType.EMOJI, document.getIconType());

        applier.applyCoverForCreate(document, new DocumentCoverRequest("LINK", "https://example.com/c.png", null));
        assertEquals(DocumentCoverType.LINK, document.getCoverType());
        assertEquals(0.5, document.getCoverPosition());
    }

    @Test
    void applyIcon_builtin_savesValidColor() {
        when(iconCatalog.isValidSlug("home")).thenReturn(true);
        applier.applyIcon(document, new DocumentIconRequest("builtin", "home", "blue"));

        assertEquals(DocumentIconType.BUILTIN, document.getIconType());
        assertEquals("home", document.getIconValue());
        assertEquals("blue", document.getIconColor());
    }

    @Test
    void applyIcon_builtin_defaultColor_storedAsNull() {
        when(iconCatalog.isValidSlug("home")).thenReturn(true);
        applier.applyIcon(document, new DocumentIconRequest("builtin", "home", "default"));

        assertEquals(DocumentIconType.BUILTIN, document.getIconType());
        assertEquals("home", document.getIconValue());
        assertNull(document.getIconColor());
    }

    @Test
    void applyIcon_builtin_blankColor_storedAsNull() {
        when(iconCatalog.isValidSlug("home")).thenReturn(true);
        applier.applyIcon(document, new DocumentIconRequest("builtin", "home", " "));

        assertEquals(DocumentIconType.BUILTIN, document.getIconType());
        assertEquals("home", document.getIconValue());
        assertNull(document.getIconColor());
    }

    @Test
    void applyIcon_emoji_blankColor_storedAsNull() {
        // Blank must read as absent before the "color is only for builtins" rule, or
        // an empty color on a non-builtin icon is rejected as an unknown color.
        applier.applyIcon(document, new DocumentIconRequest("emoji", "📝", " "));

        assertEquals(DocumentIconType.EMOJI, document.getIconType());
        assertEquals("📝", document.getIconValue());
        assertNull(document.getIconColor());
    }

    @Test
    void applyIcon_builtin_unknownColor_rejected() {
        when(iconCatalog.isValidSlug("home")).thenReturn(true);
        ApiException ex = assertThrows(
                ApiException.class,
                () -> applier.applyIcon(document, new DocumentIconRequest("builtin", "home", "rainbow")));
        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
    }

    @Test
    void applyIcon_nonBuiltin_colorRejected() {
        ApiException ex = assertThrows(
                ApiException.class, () -> applier.applyIcon(document, new DocumentIconRequest("emoji", "📝", "blue")));
        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
    }

    @Test
    void applyIcon_link_colorRejected() {
        ApiException ex = assertThrows(
                ApiException.class,
                () -> applier.applyIcon(document, new DocumentIconRequest("link", "https://example.com/a.png", "red")));
        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
    }

    @Test
    void applyIcon_clear_clearsColor() {
        document.setIconType(DocumentIconType.BUILTIN);
        document.setIconValue("home");
        document.setIconColor("blue");

        applier.applyIcon(document, new DocumentIconRequest(null, null));

        assertNull(document.getIconType());
        assertNull(document.getIconValue());
        assertNull(document.getIconColor());
    }

    private static Attachment attachment(UUID owningDocumentId, String contentType) {
        Document owner = Document.builder().id(owningDocumentId).title("Owner").build();
        return Attachment.builder()
                .id(UUID.randomUUID())
                .document(owner)
                .fileName("image.png")
                .contentType(contentType)
                .sizeBytes(10)
                .storageKey(owningDocumentId + "/file")
                .sha256("0".repeat(64))
                .build();
    }
}
