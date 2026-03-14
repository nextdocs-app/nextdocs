package com.nextdocs.api.auth.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class JwtTokenProviderTest {

    private static final String TEST_SECRET = "test-secret-that-is-at-least-32-bytes-long-for-hmac";
    private static final long EXPIRY_MS = 900_000L; // 15 min

    private JwtTokenProvider provider;

    @BeforeEach
    void setUp() {
        provider = new JwtTokenProvider();
        ReflectionTestUtils.setField(provider, "jwtSecret", TEST_SECRET);
        ReflectionTestUtils.setField(provider, "accessTokenExpiryMs", EXPIRY_MS);
        provider.init();
    }

    @Test
    void generateAccessToken_producesNonBlankToken() {
        UUID userId = UUID.randomUUID();

        String token = provider.generateAccessToken(userId, "user@example.com");

        assertThat(token).isNotBlank();
    }

    @Test
    void validateAndExtractClaims_returnsCorrectSubjectAndEmail() {
        UUID userId = UUID.randomUUID();
        String email = "alice@example.com";

        String token = provider.generateAccessToken(userId, email);
        Claims claims = provider.validateAndExtractClaims(token);

        assertThat(claims.getSubject()).isEqualTo(userId.toString());
        assertThat(claims.get("email", String.class)).isEqualTo(email);
    }

    @Test
    void extractUserId_returnsUUIDMatchingInput() {
        UUID userId = UUID.randomUUID();

        String token = provider.generateAccessToken(userId, "user@example.com");

        assertThat(provider.extractUserId(token)).isEqualTo(userId);
    }

    @Test
    void isTokenValid_returnsTrue_forFreshToken() {
        String token = provider.generateAccessToken(UUID.randomUUID(), "user@example.com");

        assertThat(provider.isTokenValid(token)).isTrue();
    }

    @Test
    void isTokenValid_returnsFalse_forMalformedToken() {
        assertThat(provider.isTokenValid("not.a.jwt")).isFalse();
    }

    @Test
    void isTokenValid_returnsFalse_forTokenSignedWithDifferentKey() {
        JwtTokenProvider other = new JwtTokenProvider();
        ReflectionTestUtils.setField(other, "jwtSecret", "different-secret-that-is-32-bytes-long12");
        ReflectionTestUtils.setField(other, "accessTokenExpiryMs", EXPIRY_MS);
        other.init();

        String token = other.generateAccessToken(UUID.randomUUID(), "user@example.com");

        assertThat(provider.isTokenValid(token)).isFalse();
    }

    @Test
    void isTokenValid_returnsFalse_forExpiredToken() {
        JwtTokenProvider shortLived = new JwtTokenProvider();
        ReflectionTestUtils.setField(shortLived, "jwtSecret", TEST_SECRET);
        ReflectionTestUtils.setField(shortLived, "accessTokenExpiryMs", -1_000L); // already expired
        shortLived.init();

        String token = shortLived.generateAccessToken(UUID.randomUUID(), "user@example.com");

        assertThat(provider.isTokenValid(token)).isFalse();
    }

    @Test
    void validateAndExtractClaims_throwsJwtException_forInvalidToken() {
        assertThatThrownBy(() -> provider.validateAndExtractClaims("bad.token.here"))
                .isInstanceOf(JwtException.class);
    }

    @Test
    void getAccessTokenExpiryMs_returnsConfiguredValue() {
        assertThat(provider.getAccessTokenExpiryMs()).isEqualTo(EXPIRY_MS);
    }
}
