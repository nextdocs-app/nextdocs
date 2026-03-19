package com.nextdocs.api.auth.entity;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.OffsetDateTime;
import org.junit.jupiter.api.Test;

class RefreshTokenTest {

    @Test
    void isExpired_whenExpiresAtInFuture_returnsFalse() {
        // Arrange
        RefreshToken token = RefreshToken.builder()
                .tokenHash("abc123")
                .expiresAt(OffsetDateTime.now().plusHours(1))
                .build();

        // Act & Assert
        assertThat(token.isExpired()).isFalse();
    }

    @Test
    void isExpired_whenExpiresAtInPast_returnsTrue() {
        // Arrange
        RefreshToken token = RefreshToken.builder()
                .tokenHash("abc123")
                .expiresAt(OffsetDateTime.now().minusSeconds(1))
                .build();

        // Act & Assert
        assertThat(token.isExpired()).isTrue();
    }

    @Test
    void isValid_whenNotRevokedAndNotExpired_returnsTrue() {
        // Arrange
        RefreshToken token = RefreshToken.builder()
                .tokenHash("abc123")
                .expiresAt(OffsetDateTime.now().plusHours(1))
                .revoked(false)
                .build();

        // Act & Assert
        assertThat(token.isValid()).isTrue();
    }

    @Test
    void isValid_whenRevoked_returnsFalse() {
        // Arrange
        RefreshToken token = RefreshToken.builder()
                .tokenHash("abc123")
                .expiresAt(OffsetDateTime.now().plusHours(1))
                .revoked(true)
                .build();

        // Act & Assert
        assertThat(token.isValid()).isFalse();
    }

    @Test
    void isValid_whenExpired_returnsFalse() {
        // Arrange
        RefreshToken token = RefreshToken.builder()
                .tokenHash("abc123")
                .expiresAt(OffsetDateTime.now().minusSeconds(1))
                .revoked(false)
                .build();

        // Act & Assert
        assertThat(token.isValid()).isFalse();
    }

    @Test
    void isValid_whenRevokedAndExpired_returnsFalse() {
        // Arrange
        RefreshToken token = RefreshToken.builder()
                .tokenHash("abc123")
                .expiresAt(OffsetDateTime.now().minusSeconds(1))
                .revoked(true)
                .build();

        // Act & Assert
        assertThat(token.isValid()).isFalse();
    }
}
