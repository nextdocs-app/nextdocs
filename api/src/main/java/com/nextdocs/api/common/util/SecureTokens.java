package com.nextdocs.api.common.util;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;

/**
 * Minting and hashing for opaque single-use tokens (refresh tokens, invitation links).
 *
 * <p>A raw token is a 256-bit {@link SecureRandom} value in URL-safe Base64 without
 * padding: URL-safe because it travels in links and cookies, unpadded because {@code =}
 * is awkward inside a URL fragment. Only the SHA-256 hex digest is stored or compared,
 * so a leaked store yields no usable tokens.
 */
public final class SecureTokens {

    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private SecureTokens() {}

    /** A fresh 256-bit token; each call is statistically unique. */
    public static String mint() {
        byte[] bytes = new byte[32]; // 256 bits
        SECURE_RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /** Lowercase hex SHA-256 of {@code token}; the only form ever persisted. */
    public static String sha256Hex(String token) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(token.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required but not available", e);
        }
    }
}
