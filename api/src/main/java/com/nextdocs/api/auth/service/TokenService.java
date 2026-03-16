package com.nextdocs.api.auth.service;

import com.nextdocs.api.auth.entity.RefreshToken;
import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.RefreshTokenRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.util.Arrays;
import java.util.Base64;
import java.util.HexFormat;
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
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private final RefreshTokenRepository refreshTokenRepository;

    @Value("${app.jwt.refresh-token-expiry-ms}")
    private long refreshTokenExpiryMs;

    @Value("${app.cookie.secure}")
    private boolean cookieSecure;

    @Value("${app.cookie.domain}")
    private String cookieDomain;

    @Transactional
    public String issueRefreshToken(User user, HttpServletRequest req, HttpServletResponse res) {
        String rawToken = generateRawToken();
        String hash = sha256Hex(rawToken);

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

        String hash = sha256Hex(rawToken);
        RefreshToken stored = refreshTokenRepository
                .findByTokenHash(hash)
                .orElseThrow(() -> new ApiException(ErrorCode.REFRESH_TOKEN_INVALID));

        if (!stored.isValid()) {
            // Possible token reuse — revoke all tokens for this user as a precaution
            log.warn(
                    "Invalid/expired refresh token used for user {}. Revoking all tokens.",
                    stored.getUser().getId());
            refreshTokenRepository.revokeAllForUser(stored.getUser().getId());
            throw new ApiException(ErrorCode.REFRESH_TOKEN_INVALID);
        }

        // Revoke the used token (rotation)
        stored.setRevoked(true);
        refreshTokenRepository.save(stored);

        User user = stored.getUser();
        issueRefreshToken(user, req, res);
        return user;
    }

    @Transactional
    public void revokeRefreshToken(HttpServletRequest req, HttpServletResponse res) {
        extractRefreshTokenCookie(req).ifPresent(rawToken -> {
            String hash = sha256Hex(rawToken);
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

    // --- Crypto helpers ---

    private String generateRawToken() {
        byte[] bytes = new byte[32]; // 256 bits
        SECURE_RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private String sha256Hex(String input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(input.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required but not available", e);
        }
    }

    private InetAddress resolveIp(HttpServletRequest request) {
        try {
            String forwarded = request.getHeader("X-Forwarded-For");
            String ip = (forwarded != null) ? forwarded.split(",")[0].trim() : request.getRemoteAddr();
            return InetAddress.getByName(ip);
        } catch (UnknownHostException e) {
            return null;
        }
    }
}
