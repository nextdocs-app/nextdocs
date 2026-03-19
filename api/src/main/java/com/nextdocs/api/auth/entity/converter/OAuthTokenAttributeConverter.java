package com.nextdocs.api.auth.entity.converter;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;
import jakarta.persistence.PersistenceException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Encrypts OAuth tokens at rest using AES-GCM (128-, 192-, or 256-bit key).
 *
 * The encryption key is resolved once at construction time so that a missing
 * or invalid key causes an immediate startup failure rather than a silent error
 * on the first DB operation.
 */
@Converter
public class OAuthTokenAttributeConverter implements AttributeConverter<String, String> {

    private static final String CIPHER_ALGORITHM = "AES/GCM/NoPadding";
    private static final int IV_LENGTH_BYTES = 12;
    private static final int TAG_LENGTH_BITS = 128;
    private static final String VALUE_PREFIX = "v1:";
    private static final String ENV_KEY = "OAUTH_TOKEN_ENCRYPTION_KEY_BASE64";
    private static final String PROPERTY_KEY = "oauth.token.encryption.key-base64";

    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    /** Resolved and validated once at construction time — fail-fast at application startup. */
    private final SecretKeySpec secretKey;

    public OAuthTokenAttributeConverter() {
        this.secretKey = resolveSecretKey();
    }

    @Override
    public String convertToDatabaseColumn(String attribute) {
        if (attribute == null) {
            return null;
        }

        try {
            byte[] iv = new byte[IV_LENGTH_BYTES];
            SECURE_RANDOM.nextBytes(iv);

            Cipher cipher = Cipher.getInstance(CIPHER_ALGORITHM);
            cipher.init(Cipher.ENCRYPT_MODE, secretKey, new GCMParameterSpec(TAG_LENGTH_BITS, iv));
            byte[] ciphertext = cipher.doFinal(attribute.getBytes(StandardCharsets.UTF_8));

            byte[] payload = new byte[iv.length + ciphertext.length];
            System.arraycopy(iv, 0, payload, 0, iv.length);
            System.arraycopy(ciphertext, 0, payload, iv.length, ciphertext.length);

            return VALUE_PREFIX + Base64.getEncoder().encodeToString(payload);
        } catch (GeneralSecurityException | IllegalArgumentException e) {
            throw new PersistenceException("Failed to encrypt OAuth token", e);
        }
    }

    @Override
    public String convertToEntityAttribute(String dbData) {
        if (dbData == null) {
            return null;
        }

        if (!dbData.startsWith(VALUE_PREFIX)) {
            throw new PersistenceException("OAuth token payload has unsupported format");
        }

        try {
            byte[] payload = Base64.getDecoder().decode(dbData.substring(VALUE_PREFIX.length()));
            if (payload.length <= IV_LENGTH_BYTES) {
                throw new PersistenceException("OAuth token payload is too short");
            }

            byte[] iv = Arrays.copyOfRange(payload, 0, IV_LENGTH_BYTES);
            byte[] ciphertext = Arrays.copyOfRange(payload, IV_LENGTH_BYTES, payload.length);

            Cipher cipher = Cipher.getInstance(CIPHER_ALGORITHM);
            cipher.init(Cipher.DECRYPT_MODE, secretKey, new GCMParameterSpec(TAG_LENGTH_BITS, iv));
            byte[] plaintext = cipher.doFinal(ciphertext);
            return new String(plaintext, StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IllegalArgumentException e) {
            throw new PersistenceException("Failed to decrypt OAuth token", e);
        }
    }

    private static SecretKeySpec resolveSecretKey() {
        String configuredKey = System.getenv(ENV_KEY);
        if (configuredKey == null || configuredKey.isBlank()) {
            configuredKey = System.getProperty(PROPERTY_KEY);
        }

        if (configuredKey == null || configuredKey.isBlank()) {
            throw new PersistenceException(
                    "OAuth token encryption key is not configured. Set " + ENV_KEY + " or " + PROPERTY_KEY + ".");
        }

        // Reject the shipped placeholder — using a known sentinel as an encryption key
        // defeats encryption entirely, so this is always fatal regardless of profile.
        if ("CHANGE_ME_IN_PRODUCTION".equals(configuredKey)) {
            throw new PersistenceException("OAUTH_TOKEN_ENCRYPTION_KEY_BASE64 is still set to the placeholder value. "
                    + "Generate a real key with: openssl rand -base64 32 | tr -d '\\n'");
        }

        try {
            byte[] keyBytes = Base64.getDecoder().decode(configuredKey);
            int keyLength = keyBytes.length;
            if (keyLength != 16 && keyLength != 24 && keyLength != 32) {
                throw new PersistenceException(
                        "Invalid OAuth token encryption key length: " + keyLength + " bytes. "
                                + "Expected 16 bytes (AES-128), 24 bytes (AES-192), or 32 bytes (AES-256) after Base64 decoding.");
            }
            return new SecretKeySpec(keyBytes, "AES");
        } catch (IllegalArgumentException e) {
            throw new PersistenceException("OAuth token encryption key is not valid Base64", e);
        }
    }
}
