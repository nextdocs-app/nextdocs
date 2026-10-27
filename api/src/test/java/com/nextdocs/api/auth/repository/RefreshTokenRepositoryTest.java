package com.nextdocs.api.auth.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.nextdocs.api.auth.entity.RefreshToken;
import com.nextdocs.api.auth.entity.User;
import jakarta.persistence.EntityManager;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

/**
 * Pins the bulk revocation statements against the persistence layer. Rotation grace
 * must never survive a deliberate sign-out: a token rotated seconds before logout is
 * still inside the reuse window, and its {@code rotatedAt} has to be cleared with the
 * revocation or replaying the replaced cookie would mint a fresh session.
 */
@SpringBootTest
@Transactional
class RefreshTokenRepositoryTest {

    @Autowired
    private RefreshTokenRepository refreshTokenRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private EntityManager entityManager;

    private User user;

    @BeforeEach
    void setUp() {
        user = userRepository.saveAndFlush(User.builder()
                .email("token-owner@example.com")
                .displayName("Token Owner")
                .build());
    }

    @Test
    void revokeAllForUser_revokesAndDropsRotationGrace() {
        RefreshToken active = token("active-hash", false, null);
        RefreshToken rotated = token("rotated-hash", true, OffsetDateTime.now().minusSeconds(5));

        assertThat(refreshTokenRepository.revokeAllForUser(user.getId())).isEqualTo(2);

        entityManager.clear();
        assertThat(reload(active.getId()).isRevoked()).isTrue();
        RefreshToken reloadedRotated = reload(rotated.getId());
        assertThat(reloadedRotated.isRevoked()).isTrue();
        assertThat(reloadedRotated.getRotatedAt()).isNull();
    }

    @Test
    void clearRotationGraceForUser_leavesRevocationStateAlone() {
        RefreshToken rotated = token("rotated-hash", true, OffsetDateTime.now().minusSeconds(5));

        assertThat(refreshTokenRepository.clearRotationGraceForUser(user.getId()))
                .isEqualTo(1);

        entityManager.clear();
        RefreshToken reloaded = reload(rotated.getId());
        assertThat(reloaded.isRevoked()).isTrue();
        assertThat(reloaded.getRotatedAt()).isNull();
    }

    private RefreshToken token(String hash, boolean revoked, OffsetDateTime rotatedAt) {
        return refreshTokenRepository.saveAndFlush(RefreshToken.builder()
                .user(user)
                .tokenHash(hash)
                .expiresAt(OffsetDateTime.now().plusHours(1))
                .revoked(revoked)
                .rotatedAt(rotatedAt)
                .build());
    }

    private RefreshToken reload(UUID id) {
        return entityManager.find(RefreshToken.class, id);
    }
}
