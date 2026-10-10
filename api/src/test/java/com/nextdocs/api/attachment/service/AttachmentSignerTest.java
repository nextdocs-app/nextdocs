package com.nextdocs.api.attachment.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.nextdocs.api.attachment.config.AttachmentProperties;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

@ExtendWith(OutputCaptureExtension.class)
class AttachmentSignerTest {

    private static final String SECRET = "unit-test-attachment-signing-secret-0123456789";
    private static final String JWT_SECRET = "unit-test-jwt-signing-secret-0123456789abcdef";

    private AttachmentSigner signer;

    @BeforeEach
    void setUp() {
        AttachmentProperties properties = new AttachmentProperties();
        properties.setSigningSecret(SECRET);
        properties.setUrlTtl(Duration.ofHours(1));
        signer = new AttachmentSigner(properties, JWT_SECRET);
    }

    @Test
    void sign_producesSignatureForFutureExpiry() {
        UUID attachmentId = UUID.randomUUID();

        AttachmentSigner.SignedUrl signed = signer.sign(attachmentId);

        assertThat(signed.signature()).isNotBlank();
        assertThatCode(() -> signer.verify(attachmentId, signed.expiresAt(), signed.signature()))
                .doesNotThrowAnyException();
    }

    @Test
    void verify_signatureForDifferentAttachment_throwsNotFound() {
        AttachmentSigner.SignedUrl signed = signer.sign(UUID.randomUUID());

        assertNotFound(() -> signer.verify(UUID.randomUUID(), signed.expiresAt(), signed.signature()));
    }

    @Test
    void verify_tamperedSignature_throwsNotFound() {
        UUID attachmentId = UUID.randomUUID();
        AttachmentSigner.SignedUrl signed = signer.sign(attachmentId);

        assertNotFound(() -> signer.verify(attachmentId, signed.expiresAt(), signed.signature() + "x"));
    }

    @Test
    void verify_expiredSignature_throwsNotFound() {
        AttachmentProperties properties = new AttachmentProperties();
        properties.setSigningSecret(SECRET);
        properties.setUrlTtl(Duration.ofSeconds(-5));
        AttachmentSigner expiredSigner = new AttachmentSigner(properties, JWT_SECRET);

        UUID attachmentId = UUID.randomUUID();
        AttachmentSigner.SignedUrl expired = expiredSigner.sign(attachmentId);

        assertNotFound(() -> signer.verify(attachmentId, expired.expiresAt(), expired.signature()));
    }

    /**
     * The expiry second itself is expired: a TTL of zero mints {@code exp == now} and must
     * not be accepted. A strict {@code <} comparison would serve the URL for up to a second
     * past its expiry.
     */
    @Test
    void verify_expirySecondItself_throwsNotFound() {
        AttachmentProperties properties = new AttachmentProperties();
        properties.setSigningSecret(SECRET);
        properties.setUrlTtl(Duration.ZERO);
        AttachmentSigner zeroTtlSigner = new AttachmentSigner(properties, JWT_SECRET);

        UUID attachmentId = UUID.randomUUID();
        AttachmentSigner.SignedUrl signed = zeroTtlSigner.sign(attachmentId);

        assertNotFound(() -> signer.verify(attachmentId, signed.expiresAt(), signed.signature()));
    }

    @Test
    void verify_missingSignature_throwsNotFound() {
        assertNotFound(() -> signer.verify(UUID.randomUUID(), 4_102_444_800L, ""));
    }

    @Test
    void verify_nullSignature_throwsNotFound() {
        assertNotFound(() -> signer.verify(UUID.randomUUID(), 4_102_444_800L, null));
    }

    /**
     * A signature minted under one secret must not verify under another, so a rotated or
     * misconfigured key cannot keep old URLs alive.
     */
    @Test
    void verify_signatureFromDifferentSecret_throwsNotFound() {
        AttachmentProperties otherProperties = new AttachmentProperties();
        otherProperties.setSigningSecret("a-different-signing-secret-0123456789abcdef");
        otherProperties.setUrlTtl(Duration.ofHours(1));
        AttachmentSigner otherSigner = new AttachmentSigner(otherProperties, JWT_SECRET);

        UUID attachmentId = UUID.randomUUID();
        AttachmentSigner.SignedUrl signed = otherSigner.sign(attachmentId);

        assertNotFound(() -> signer.verify(attachmentId, signed.expiresAt(), signed.signature()));
    }

    @Test
    void constructor_withoutSecret_failsFast() {
        AttachmentProperties properties = new AttachmentProperties();
        properties.setSigningSecret("  ");

        assertThatThrownBy(() -> new AttachmentSigner(properties, ""))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("signing secret");
    }

    @Test
    void constructor_withShortSecret_failsFast() {
        AttachmentProperties properties = new AttachmentProperties();
        properties.setSigningSecret("too-short");

        assertThatThrownBy(() -> new AttachmentSigner(properties, JWT_SECRET))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("at least 32 bytes");
    }

    @Test
    void constructor_withPlaceholderSecret_failsFast() {
        AttachmentProperties properties = new AttachmentProperties();
        properties.setSigningSecret("CHANGE_ME_IN_PRODUCTION");

        assertThatThrownBy(() -> new AttachmentSigner(properties, JWT_SECRET))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("signing secret");
    }

    @Test
    void constructor_withoutExplicitSecret_fallsBackToJwtSecretAndWarns(CapturedOutput output) {
        AttachmentProperties properties = new AttachmentProperties();
        properties.setSigningSecret("");
        properties.setUrlTtl(Duration.ofHours(1));

        AttachmentSigner fallbackSigner = new AttachmentSigner(properties, JWT_SECRET);

        // The fallback must produce working signatures, and the operator must be told the
        // two protocols are sharing a key.
        assertThat(output).contains("ATTACHMENT_SIGNING_SECRET is not set");
        UUID attachmentId = UUID.randomUUID();
        AttachmentSigner.SignedUrl signed = fallbackSigner.sign(attachmentId);
        assertThatCode(() -> fallbackSigner.verify(attachmentId, signed.expiresAt(), signed.signature()))
                .doesNotThrowAnyException();
    }

    private static void assertNotFound(Runnable action) {
        assertThatThrownBy(action::run)
                .isInstanceOf(ApiException.class)
                .extracting(exception -> ((ApiException) exception).getErrorCode())
                .isEqualTo(ErrorCode.NOT_FOUND);
    }
}
