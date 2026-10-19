package com.nextdocs.api.auth.service;

import com.nextdocs.api.auth.repository.RefreshTokenRepository;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Revokes every refresh token of a user in a transaction of its own.
 *
 * <p>The callers report the refusal by throwing, which rolls the surrounding
 * transaction back: a revocation made there would be discarded along with it, and the
 * very session the check refused would survive. REQUIRES_NEW commits the revocation
 * before the exception propagates.
 */
@Component
@RequiredArgsConstructor
public class RefreshTokenRevoker {

    private final RefreshTokenRepository refreshTokenRepository;

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void revokeAllForUser(UUID userId) {
        refreshTokenRepository.revokeAllForUser(userId);
    }
}
