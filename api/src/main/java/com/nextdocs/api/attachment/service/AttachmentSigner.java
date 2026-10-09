package com.nextdocs.api.attachment.service;

import com.nextdocs.api.attachment.config.AttachmentProperties;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * Signs attachment download URLs with HMAC-SHA256.
 *
 * <p>Signature possession is the whole download capability: a valid URL keeps working
 * until it expires even if the viewer's access is revoked in the meantime. That is what
 * lets plain {@code <img>}/{@code <video>} tags load files, and why {@code url-ttl} is the
 * revocation window (the editor re-mints through {@code /url}, which re-runs the
 * permission check, on every render).
 *
 * <p>The key defaults to the JWT secret so self-hosters get working signatures with the
 * same configuration they already provide; an explicit {@code ATTACHMENT_SIGNING_SECRET}
 * keeps the two independent. Like the JWT secret, it must be at least 32 bytes, stay
 * stable across restarts and be identical across API instances.
 */
@Slf4j
@Component
public class AttachmentSigner {

    private static final String HMAC_ALGORITHM = "HmacSHA256";
    private static final String PLACEHOLDER_SECRET = "CHANGE_ME_IN_PRODUCTION";

    /** HMAC-SHA256 needs 256 bits of key material; a shorter secret weakens the signature. */
    static final int MIN_SECRET_BYTES = 32;

    private final SecretKey signingKey;
    private final Duration urlTtl;

    public AttachmentSigner(AttachmentProperties attachmentProperties, @Value("${app.jwt.secret:}") String jwtSecret) {
        String configuredSecret = attachmentProperties.getSigningSecret();
        String secret;
        if (StringUtils.hasText(configuredSecret)) {
            secret = configuredSecret.strip();
        } else {
            // Falls back to the JWT secret for self-hosters who set only one secret, but the
            // two protocols should not share a key: a leaked download URL must not reveal
            // anything about access tokens, and rotating one must not invalidate the other.
            log.warn("ATTACHMENT_SIGNING_SECRET is not set; signing attachment download URLs with the JWT "
                    + "secret. Set an explicit ATTACHMENT_SIGNING_SECRET so the two can be rotated independently.");
            secret = jwtSecret == null ? "" : jwtSecret.strip();
        }
        if (!StringUtils.hasText(secret) || PLACEHOLDER_SECRET.equals(secret)) {
            throw new IllegalStateException("The attachment signing secret must be configured "
                    + "(app.attachments.signing-secret, falls back to app.jwt.secret).");
        }
        byte[] keyBytes = secret.getBytes(StandardCharsets.UTF_8);
        if (keyBytes.length < MIN_SECRET_BYTES) {
            throw new IllegalStateException("Attachment signing secret must be at least " + MIN_SECRET_BYTES
                    + " bytes (256 bits), but only " + keyBytes.length + " bytes were provided.");
        }
        this.signingKey = new SecretKeySpec(keyBytes, HMAC_ALGORITHM);
        this.urlTtl = attachmentProperties.getUrlTtl();
    }

    public SignedUrl sign(UUID attachmentId) {
        long expiresAt = Instant.now().plus(urlTtl).getEpochSecond();
        return new SignedUrl(expiresAt, computeSignature(attachmentId, expiresAt));
    }

    /** Fails with {@link ErrorCode#NOT_FOUND} for expired or tampered signatures. */
    public void verify(UUID attachmentId, long expiresAt, String signature) {
        // <= rejects the expiry second itself: the URL is valid for its whole TTL, no more.
        if (expiresAt <= Instant.now().getEpochSecond() || !StringUtils.hasText(signature)) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
        String expected = computeSignature(attachmentId, expiresAt);
        boolean matches = MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.UTF_8), signature.getBytes(StandardCharsets.UTF_8));
        if (!matches) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
    }

    private String computeSignature(UUID attachmentId, long expiresAt) {
        try {
            Mac mac = Mac.getInstance(HMAC_ALGORITHM);
            mac.init(signingKey);
            byte[] digest = mac.doFinal((attachmentId + ":" + expiresAt).getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (GeneralSecurityException ex) {
            throw new IllegalStateException("Unable to sign the attachment URL.", ex);
        }
    }

    public record SignedUrl(long expiresAt, String signature) {}
}
