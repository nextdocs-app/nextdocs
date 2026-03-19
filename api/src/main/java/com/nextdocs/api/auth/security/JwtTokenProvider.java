package com.nextdocs.api.auth.security;

import io.jsonwebtoken.*;
import io.jsonwebtoken.security.Keys;
import io.jsonwebtoken.security.SignatureException;
import jakarta.annotation.PostConstruct;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;
import javax.crypto.SecretKey;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Handles JWT access token creation and validation.
 *
 * Only access tokens are managed here. Refresh tokens are opaque random
 * strings stored as SHA-256 hashes in the database (see {@link
 * com.nextdocs.api.auth.service.TokenService}).
 */
@Slf4j
@Component
public class JwtTokenProvider {

    @Value("${app.jwt.secret}")
    private String jwtSecret;

    @Value("${app.jwt.access-token-expiry-ms}")
    private long accessTokenExpiryMs;

    private SecretKey signingKey;

    @Value("${spring.profiles.active:}")
    private String activeProfiles;

    @PostConstruct
    void init() {
        // Reject the shipped placeholder sentinel in non-dev environments.
        if ("CHANGE_ME_IN_PRODUCTION".equals(jwtSecret)) {
            if (isDevProfile()) {
                log.warn("*** JWT_SECRET is using the insecure placeholder. "
                        + "Generate a real secret with: openssl rand -base64 32 ***");
            } else {
                throw new IllegalStateException("JWT_SECRET must be securely set before starting the application. "
                        + "Generate one with: openssl rand -base64 32");
            }
        }

        byte[] keyBytes = jwtSecret.getBytes(StandardCharsets.UTF_8);
        if (keyBytes.length < 32) {
            log.error(
                    "JWT secret is too short ({} bytes). HMAC-SHA256 requires at least 32 bytes (256 bits). "
                            + "Set a sufficiently long secret via app.jwt.secret before starting the application.",
                    keyBytes.length);
            throw new IllegalStateException("JWT secret must be at least 32 bytes (256 bits), but only "
                    + keyBytes.length + " bytes were provided.");
        }
        this.signingKey = Keys.hmacShaKeyFor(keyBytes);
    }

    private boolean isDevProfile() {
        if (activeProfiles == null || activeProfiles.isBlank()) {
            return false;
        }
        for (String p : activeProfiles.split(",")) {
            if ("dev".equalsIgnoreCase(p.trim())) {
                return true;
            }
        }
        return false;
    }

    public String generateAccessToken(UUID userId, String email) {
        if (userId == null) {
            throw new IllegalArgumentException("userId must not be null");
        }
        if (email == null || email.trim().isEmpty()) {
            throw new IllegalArgumentException("email must not be null or empty");
        }
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(userId.toString())
                .claim("email", email)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plusMillis(accessTokenExpiryMs)))
                .signWith(signingKey)
                .compact();
    }

    public Claims validateAndExtractClaims(String token) {
        if (token == null || token.isBlank()) {
            throw new MalformedJwtException("JWT token must not be null or blank");
        }
        return Jwts.parser()
                .verifyWith(signingKey)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    public boolean isTokenValid(String token) {
        if (token == null || token.trim().isEmpty()) {
            return false;
        }
        try {
            validateAndExtractClaims(token);
            return true;
        } catch (ExpiredJwtException e) {
            log.debug("JWT token has expired");
        } catch (SignatureException e) {
            log.debug("JWT signature is invalid");
        } catch (MalformedJwtException e) {
            log.debug("JWT token is malformed");
        } catch (IllegalArgumentException e) {
            log.debug("JWT token is invalid: {}", e.getMessage());
        } catch (JwtException e) {
            log.debug("JWT validation failed: {}", e.getMessage());
        }
        return false;
    }

    public UUID extractUserId(String token) {
        String subject = validateAndExtractClaims(token).getSubject();
        if (subject == null || subject.isBlank()) {
            throw new IllegalArgumentException("JWT is missing the subject claim");
        }
        return UUID.fromString(subject);
    }

    public long getAccessTokenExpiryMs() {
        return accessTokenExpiryMs;
    }
}
