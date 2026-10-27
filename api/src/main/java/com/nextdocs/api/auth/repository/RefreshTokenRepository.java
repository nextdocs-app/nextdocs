package com.nextdocs.api.auth.repository;

import com.nextdocs.api.auth.entity.RefreshToken;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

@Repository
public interface RefreshTokenRepository extends JpaRepository<RefreshToken, UUID> {

    Optional<RefreshToken> findByTokenHash(String tokenHash);

    /**
     * Revoke every refresh token for a user (e.g. on logout-all-devices).
     *
     * <p>Rotation grace is dropped at the same time: a token that was rotated moments
     * before the revocation is still inside the reuse window, and leaving its
     * {@code rotatedAt} set would let it mint a fresh session after the deliberate
     * sign-out.
     */
    @Modifying
    @Query("UPDATE RefreshToken rt SET rt.revoked = true, rt.rotatedAt = null WHERE rt.user.id = :userId")
    int revokeAllForUser(@Param("userId") UUID userId);

    /** Drop rotation grace for a user so a replaced cookie cannot refresh after logout. */
    @Modifying
    @Query("UPDATE RefreshToken rt SET rt.rotatedAt = null WHERE rt.user.id = :userId")
    int clearRotationGraceForUser(@Param("userId") UUID userId);

    /** Periodic cleanup: delete tokens that are expired or revoked. */
    @Modifying
    @Query("DELETE FROM RefreshToken rt WHERE rt.expiresAt < :cutoff OR rt.revoked = true")
    int deleteExpiredAndRevoked(@Param("cutoff") OffsetDateTime cutoff);
}
