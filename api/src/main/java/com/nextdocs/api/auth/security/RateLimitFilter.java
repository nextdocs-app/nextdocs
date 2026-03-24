package com.nextdocs.api.auth.security;

import com.nextdocs.api.auth.security.ratelimit.RateLimiter;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.common.response.ApiResponse;
import jakarta.annotation.PostConstruct;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.security.web.util.matcher.IpAddressMatcher;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.UriUtils;
import tools.jackson.databind.ObjectMapper;

/**
 * Public unauthenticated endpoint rate limiter.
 *
 * Limits each IP address within a one-minute window via the configured
 * {@link RateLimiter} implementation for:
 * - /api/v1/auth/*
 * - GET /api/v1/documents/{id}/public
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class RateLimitFilter extends OncePerRequestFilter {

    private static final String AUTH_PATH_PREFIX = "/api/v1/auth/";
    private static final String PUBLIC_DOCUMENT_PATH_PREFIX = "/api/v1/documents/";
    private static final String PUBLIC_DOCUMENT_PATH_SUFFIX = "/public";

    private final RateLimiter rateLimiter;
    private final ObjectMapper objectMapper;

    /**
     * Comma-separated list of trusted proxy IPs or CIDRs whose
     * X-Forwarded-For header is accepted, e.g.
     * 10.0.0.0/8,172.16.0.0/12. Empty by default (no trusted proxies).
     */
    @Value("${app.rate-limit.trusted-proxies:}")
    private String trustedProxiesRaw;

    private List<IpAddressMatcher> trustedProxyMatchers = List.of();

    @PostConstruct
    void initTrustedProxies() {
        if (trustedProxiesRaw == null || trustedProxiesRaw.isBlank()) {
            trustedProxyMatchers = List.of();
            return;
        }
        trustedProxyMatchers = Arrays.stream(trustedProxiesRaw.split(","))
                .map(String::trim)
                .filter(s -> !s.isBlank())
                .map(IpAddressMatcher::new)
                .collect(Collectors.toList());
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {

        if (!isRateLimitedPath(request)) {
            filterChain.doFilter(request, response);
            return;
        }

        String ip = resolveClientIp(request);
        String key = buildRateLimitKey(request, ip);

        if (!rateLimiter.allowRequest(key)) {
            String maskedIp = maskIp(ip);
            log.warn("Rate limit exceeded for IP: {}", maskedIp);
            response.setStatus(429);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.getWriter()
                    .write(objectMapper.writeValueAsString(
                            ApiResponse.error(ErrorCode.RATE_LIMIT_EXCEEDED.defaultMessage())));
            return;
        }

        filterChain.doFilter(request, response);
    }

    private boolean isRateLimitedPath(HttpServletRequest request) {
        String uri = request.getRequestURI();
        if (uri.startsWith(AUTH_PATH_PREFIX)) {
            return true;
        }

        if (!"GET".equalsIgnoreCase(request.getMethod())) {
            return false;
        }

        if (!uri.startsWith(PUBLIC_DOCUMENT_PATH_PREFIX) || !uri.endsWith(PUBLIC_DOCUMENT_PATH_SUFFIX)) {
            return false;
        }

        String middle = uri.substring(
                PUBLIC_DOCUMENT_PATH_PREFIX.length(), uri.length() - PUBLIC_DOCUMENT_PATH_SUFFIX.length());

        String decodedMiddle;
        try {
            decodedMiddle = UriUtils.decode(middle, StandardCharsets.UTF_8);
        } catch (IllegalArgumentException ignored) {
            return false;
        }

        // Match exactly /api/v1/documents/{id}/public and avoid nested paths.
        return !decodedMiddle.isBlank() && !decodedMiddle.contains("/") && !decodedMiddle.contains("%");
    }

    private String buildRateLimitKey(HttpServletRequest request, String ip) {
        if (request.getRequestURI().startsWith(AUTH_PATH_PREFIX)) {
            return "auth:" + ip;
        }
        return "public-doc:" + ip;
    }

    private String resolveClientIp(HttpServletRequest request) {
        String remoteAddr = request.getRemoteAddr();
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank() && isTrustedProxy(remoteAddr)) {
            for (String token : forwarded.split(",")) {
                String candidate = token.trim();
                if (!candidate.isEmpty()) {
                    return candidate;
                }
            }
        }
        return remoteAddr;
    }

    private boolean isTrustedProxy(String remoteAddr) {
        return trustedProxyMatchers.stream().anyMatch(m -> m.matches(remoteAddr));
    }

    static String maskIp(String ip) {
        if (ip == null || ip.isBlank()) {
            return "unknown";
        }
        // IPv4: mask last octet (e.g. 192.168.1.100 → 192.168.1.xxx)
        int lastDot = ip.lastIndexOf('.');
        if (lastDot != -1 && !ip.contains(":")) {
            return ip.substring(0, lastDot) + ".xxx";
        }
        // IPv6: mask last segment (e.g. 2001:db8::1 → 2001:db8::xxxx)
        int lastColon = ip.lastIndexOf(':');
        if (lastColon != -1) {
            return ip.substring(0, lastColon + 1) + "xxxx";
        }
        return "unknown";
    }
}
