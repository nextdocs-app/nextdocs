package com.nextdocs.api.auth.service;

import com.nextdocs.api.auth.entity.RefreshToken;
import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.RefreshTokenRepository;
import com.nextdocs.api.auth.security.ClientIpResolver;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.common.util.SecureTokens;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.time.OffsetDateTime;
import java.util.Arrays;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Manages opaque refresh tokens.
 *
 * The raw token is a 256-bit cryptographically random value encoded as
 * URL-safe Base64. Only its SHA-256 hash is persisted — the raw value exists
 * only in memory during the request and in the HTTP-only cookie on the client.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class TokenService {

    private static final String REFRESH_TOKEN_COOKIE = "rt";

    private final RefreshTokenRepository refreshTokenRepository;
    private final RefreshTokenRevoker refreshTokenRevoker;
    private final ClientIpResolver clientIpResolver;

    @Value("${app.jwt.refresh-token-expiry-ms}")
    private long refreshTokenExpiryMs;

    @Value("${app.cookie.secure}")
    private boolean cookieSecure;

    @Value("${app.cookie.domain}")
    private String cookieDomain;

    @Transactional
    public String issueRefreshToken(User user, HttpServletRequest req, HttpServletResponse res) {
        String rawToken = SecureTokens.mint();
        String hash = SecureTokens.sha256Hex(rawToken);

        RefreshToken entity = RefreshToken.builder()
                .user(user)
                .tokenHash(hash)
                .expiresAt(OffsetDateTime.now().plusNanos(refreshTokenExpiryMs * 1_000_000L))
                .ipAddress(resolveIp(req))
                .userAgent(req.getHeader("User-Agent"))
                .build();

        refreshTokenRepository.save(entity);
        writeRefreshTokenCookie(rawToken, res);
        return rawToken;
    }

    @Transactional
    public User rotateRefreshToken(HttpServletRequest req, HttpServletResponse res) {
        String rawToken =
                extractRefreshTokenCookie(req).orElseThrow(() -> new ApiException(ErrorCode.REFRESH_TOKEN_INVALID));

        String hash = SecureTokens.sha256Hex(rawToken);
        RefreshToken stored = refreshTokenRepository
                .findByTokenHash(hash)
                .orElseThrow(() -> new ApiException(ErrorCode.REFRESH_TOKEN_INVALID));

        if (!stored.isValid()) {
            // Possible token reuse — revoke all tokens for this user as a precaution.
            // The revoker commits independently: this method throws, so a revocation in
            // this transaction would be rolled back and the reused token would survive.
            log.warn(
                    "Invalid/expired refresh token used for user {}. Revoking all tokens.",
                    stored.getUser().getId());
            refreshTokenRevoker.revokeAllForUser(stored.getUser().getId());
            throw new ApiException(ErrorCode.REFRESH_TOKEN_INVALID);
        }

        User user = stored.getUser();
        if (!user.isActive()) {
            // A removed member's session must not outlive the removal by rotating here.
            // Removal revokes eagerly; this is the backstop for a token that slipped
            // through, so it revokes again (committing on its own) before refusing.
            log.warn("Refresh token used for deactivated user {}. Revoking all tokens.", user.getId());
            refreshTokenRevoker.revokeAllForUser(user.getId());
            throw new ApiException(ErrorCode.ACCOUNT_DISABLED);
        }

        // Revoke the used token (rotation)
        stored.setRevoked(true);
        refreshTokenRepository.save(stored);

        issueRefreshToken(user, req, res);
        return user;
    }

    @Transactional
    public void revokeRefreshToken(HttpServletRequest req, HttpServletResponse res) {
        extractRefreshTokenCookie(req).ifPresent(rawToken -> {
            String hash = SecureTokens.sha256Hex(rawToken);
            refreshTokenRepository.findByTokenHash(hash).ifPresent(token -> {
                token.setRevoked(true);
                refreshTokenRepository.save(token);
            });
        });
        clearRefreshTokenCookie(res);
    }

    // --- Cookie helpers ---

    private void writeRefreshTokenCookie(String rawToken, HttpServletResponse response) {
        int maxAgeSeconds = Math.max(1, (int) (refreshTokenExpiryMs / 1000));
        // SameSite=Strict: cookie is not sent on cross-site requests
        // javax.servlet.http.Cookie doesn't expose SameSite yet — use header directly
        response.addHeader("Set-Cookie", buildSetCookieHeader(REFRESH_TOKEN_COOKIE, rawToken, maxAgeSeconds));
    }

    private void clearRefreshTokenCookie(HttpServletResponse response) {
        response.addHeader("Set-Cookie", buildSetCookieHeader(REFRESH_TOKEN_COOKIE, "", 0));
    }

    private String buildSetCookieHeader(String name, String value, int maxAge) {
        StringBuilder sb = new StringBuilder();
        sb.append(name).append("=").append(value);
        sb.append("; Path=/api/v1/auth/");
        sb.append("; Max-Age=").append(maxAge);
        sb.append("; HttpOnly");
        if (cookieSecure) sb.append("; Secure");
        sb.append("; SameSite=Strict");
        if (!cookieDomain.isBlank()) sb.append("; Domain=").append(cookieDomain);
        return sb.toString();
    }

    private Optional<String> extractRefreshTokenCookie(HttpServletRequest request) {
        if (request.getCookies() == null) return Optional.empty();
        return Arrays.stream(request.getCookies())
                .filter(c -> REFRESH_TOKEN_COOKIE.equals(c.getName()))
                .map(Cookie::getValue)
                .findFirst();
    }

    private InetAddress resolveIp(HttpServletRequest request) {
        String ip = clientIpResolver.resolve(request);
        if (ip.isEmpty()) {
            return null;
        }
        try {
            // resolve() only yields IP literals, so this never performs a DNS lookup.
            return InetAddress.getByName(ip);
        } catch (UnknownHostException e) {
            return null;
        }
    }
}
