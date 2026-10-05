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
import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.util.matcher.IpAddressMatcher;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.UriUtils;
import tools.jackson.databind.ObjectMapper;

/**
 * Public unauthenticated endpoint rate limiter.
 *
 * Buckets are tiered so normal share-link browsing never starves on the same
 * budget as credentialed or write traffic:
 * - {@code auth:<ip>} — /api/v1/auth/* (login/signup/refresh), strict default budget.
 * - {@code public-read:<ip>} — anonymous reads: GET .../public, /public/path,
 *   /public/children and anonymous GET .../access-check, .../my-access.
 * - {@code public-write:<ip>} — anonymous saves: PATCH .../public, strict budget.
 *
 * Authenticated access-check/my-access calls (verified UserPrincipal in SecurityContext)
 * are not rate limited here: the caller is identified by JWT and the rest of the
 * API is unthrottled, so throttling them would only starve guests sharing the
 * same egress IP (same office, same NAT, adjacent browser tabs).
 */
@Slf4j
@Component
public class RateLimitFilter extends OncePerRequestFilter {

    private static final String AUTH_PATH_PREFIX = "/api/v1/auth/";
    private static final String PUBLIC_DOCUMENT_PATH_PREFIX = "/api/v1/documents/";

    private final RateLimiter rateLimiter;
    private final ObjectMapper objectMapper;
    private final int publicReadMaxRequests;
    private final Duration publicReadWindow;
    private final int publicWriteMaxRequests;
    private final Duration publicWriteWindow;

    public RateLimitFilter(
            RateLimiter rateLimiter,
            ObjectMapper objectMapper,
            @Value("${app.rate-limit.public-read-max-requests:120}") int publicReadMaxRequests,
            @Value("${app.rate-limit.public-read-window-seconds:60}") long publicReadWindowSeconds,
            @Value("${app.rate-limit.public-write-max-requests:20}") int publicWriteMaxRequests,
            @Value("${app.rate-limit.public-write-window-seconds:60}") long publicWriteWindowSeconds) {
        this.rateLimiter = rateLimiter;
        this.objectMapper = objectMapper;
        this.publicReadMaxRequests = publicReadMaxRequests;
        this.publicReadWindow = Duration.ofSeconds(publicReadWindowSeconds);
        this.publicWriteMaxRequests = publicWriteMaxRequests;
        this.publicWriteWindow = Duration.ofSeconds(publicWriteWindowSeconds);
    }

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

        Verdict verdict = classify(request);
        if (!verdict.limited()) {
            filterChain.doFilter(request, response);
            return;
        }

        String ip = resolveClientIp(request);
        String key = verdict.bucketPrefix() + ip;

        boolean allowed = verdict.useDefaultBudget()
                ? rateLimiter.allowRequest(key)
                : rateLimiter.allowRequest(key, verdict.maxRequests(), verdict.window());

        if (!allowed) {
            String maskedIp = maskIp(ip);
            log.warn("Rate limit exceeded for IP: {}", maskedIp);
            response.setStatus(429);
            response.setHeader("Retry-After", String.valueOf(verdict.window().getSeconds()));
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.getWriter()
                    .write(objectMapper.writeValueAsString(
                            ApiResponse.error(ErrorCode.RATE_LIMIT_EXCEEDED.defaultMessage())));
            return;
        }

        filterChain.doFilter(request, response);
    }

    /**
     * Decides whether a request is throttled and, if so, in which bucket.
     * An absent verdict ({@code limited=false}) passes through untouched.
     */
    private Verdict classify(HttpServletRequest request) {
        String uri = request.getRequestURI();
        if (uri.startsWith(AUTH_PATH_PREFIX)) {
            return Verdict.defaultBudget("auth:");
        }

        if (!uri.startsWith(PUBLIC_DOCUMENT_PATH_PREFIX)) {
            return Verdict.unlimited();
        }

        String middle = uri.substring(PUBLIC_DOCUMENT_PATH_PREFIX.length());

        String decodedMiddle;
        try {
            decodedMiddle = UriUtils.decode(middle, StandardCharsets.UTF_8);
        } catch (IllegalArgumentException ignored) {
            return Verdict.unlimited();
        }

        if (decodedMiddle.isBlank() || decodedMiddle.contains("%")) {
            return Verdict.unlimited();
        }

        // Strip trailing slash(es) so /public/ matches /public
        while (decodedMiddle.endsWith("/")) {
            decodedMiddle = decodedMiddle.substring(0, decodedMiddle.length() - 1);
        }
        if (decodedMiddle.isBlank()) {
            return Verdict.unlimited();
        }

        String method = request.getMethod();
        String[] parts = decodedMiddle.split("/");
        if (!parts[0].isBlank() && parts.length == 2 && parts[1].equals("public")) {
            // Match /api/v1/documents/{id}/public for reads (GET) and
            // anonymous share-link saves (PATCH).
            if ("PATCH".equalsIgnoreCase(method)) {
                return Verdict.customBudget("public-write:", publicWriteMaxRequests, publicWriteWindow);
            }
            if ("GET".equalsIgnoreCase(method)) {
                return Verdict.customBudget("public-read:", publicReadMaxRequests, publicReadWindow);
            }
            return Verdict.unlimited();
        }

        if (!"GET".equalsIgnoreCase(method)) {
            return Verdict.unlimited();
        }

        if (parts.length == 2
                && !parts[0].isBlank()
                && (parts[1].equals("access-check") || parts[1].equals("my-access"))) {
            // Match exactly /api/v1/documents/{id}/access-check and /my-access.
            // Identified callers are exempt: throttling them would starve guests
            // sharing the same egress IP, and the rest of the API is unthrottled.
            // Gated on a verified principal in SecurityContext (populated by JwtAuthenticationFilter).
            if (isAuthenticatedCaller()) {
                return Verdict.unlimited();
            }
            return Verdict.customBudget("public-read:", publicReadMaxRequests, publicReadWindow);
        }

        // Match exactly /api/v1/documents/{id}/public/path and /public/children,
        // and avoid nested paths.
        if (parts.length == 3
                && !parts[0].isBlank()
                && parts[1].equals("public")
                && (parts[2].equals("path") || parts[2].equals("children"))) {
            return Verdict.customBudget("public-read:", publicReadMaxRequests, publicReadWindow);
        }

        return Verdict.unlimited();
    }

    private boolean isAuthenticatedCaller() {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        return auth != null && auth.isAuthenticated() && auth.getPrincipal() instanceof UserPrincipal;
    }

    /**
     * Throttling decision for one request: which bucket key prefix applies and
     * with what budget. {@code useDefaultBudget} keeps the legacy 20/min
     * behavior (auth endpoints); custom budgets are configured per category.
     */
    private record Verdict(
            boolean limited, String bucketPrefix, boolean useDefaultBudget, int maxRequests, Duration window) {
        static Verdict unlimited() {
            return new Verdict(false, "", true, 0, Duration.ZERO);
        }

        static Verdict defaultBudget(String bucketPrefix) {
            return new Verdict(true, bucketPrefix, true, RateLimiter.DEFAULT_MAX_REQUESTS, RateLimiter.DEFAULT_WINDOW);
        }

        static Verdict customBudget(String bucketPrefix, int maxRequests, Duration window) {
            return new Verdict(true, bucketPrefix, false, maxRequests, window);
        }
    }

    private String resolveClientIp(HttpServletRequest request) {
        String remoteAddr = normalizeIp(request.getRemoteAddr());
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank() && isTrustedProxy(request.getRemoteAddr())) {
            for (String token : forwarded.split(",")) {
                String candidate = normalizeIp(token.trim());
                if (!candidate.isEmpty()) {
                    return candidate;
                }
            }
        }
        return remoteAddr;
    }

    static String normalizeIp(String ip) {
        if (ip == null) {
            return "";
        }
        String trimmed = ip.trim();
        if (trimmed.regionMatches(true, 0, "::ffff:", 0, 7)) {
            return trimmed.substring(7);
        }
        return trimmed;
    }

    private boolean isTrustedProxy(String remoteAddr) {
        String normalized = normalizeIp(remoteAddr);
        return trustedProxyMatchers.stream().anyMatch(m -> m.matches(remoteAddr) || m.matches(normalized));
    }

    static String maskIp(String rawIp) {
        String ip = normalizeIp(rawIp);
        if (ip.isBlank()) {
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
