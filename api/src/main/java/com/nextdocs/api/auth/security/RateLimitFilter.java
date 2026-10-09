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
import java.util.UUID;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.util.matcher.IpAddressMatcher;
import org.springframework.stereotype.Component;
import org.springframework.util.unit.DataSize;
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
 * - {@code public-write:<ip>} — anonymous saves: PATCH .../public, strict budget
 *   plus an actual body-size ceiling (the controller's own snapshot-size guard
 *   runs only after the body has been parsed, so the limit has to be enforced here,
 *   on bytes read rather than on the declared Content-Length which chunked
 *   uploads omit).
 * - {@code upload-ip:<ip>} + {@code upload:<userId>} — authenticated attachment uploads
 *   (POST .../attachments). Consumes both buckets so neither one account nor one
 *   egress address can queue disk-filling requests. A declared body over the multipart
 *   ceiling is rejected before the container buffers it, and because the multipart
 *   parser reads the same stream the filter would consume, uploads without a declared
 *   Content-Length are rejected outright rather than bounded by a byte-counting read.
 * - {@code download:<ip>} — attachment downloads (GET|HEAD .../attachments/{id}/file),
 *   including every range seek, plus anonymous signed-URL mints (GET|HEAD
 *   .../attachments/{id}/url). A single document open fans out across many files
 *   and media seeking multiplies that, so mints and downloads get their own larger
 *   per-address budget instead of starving browsing. Reads stay on
 *   {@code public-read:<ip>}.
 *
 * Authenticated access-check/my-access calls and signed-URL minting (GET
 * .../attachments/{id}/url, verified UserPrincipal in SecurityContext) are not rate
 * limited here: the caller is identified by JWT and the rest of the API is
 * unthrottled, so throttling them would only starve guests sharing the
 * same egress IP (same office, same NAT, adjacent browser tabs). Anonymous mints join
 * the download budget for the same fan-out reason: media tags cannot send an
 * Authorization header, so a downloader is anonymous to the server by construction.
 *
 * A 429 carries the wait until the bucket's next token, not the length of its
 * window: with greedy refill those differ by an order of magnitude at the default
 * limits, and clients (the editor's cloud backoff included) sleep for the value.
 */
@Slf4j
@Component
public class RateLimitFilter extends OncePerRequestFilter {

    private static final String AUTH_PATH_PREFIX = "/api/v1/auth/";
    private static final String PUBLIC_DOCUMENT_PATH_PREFIX = "/api/v1/documents/";
    private static final String ATTACHMENT_PATH_PREFIX = "/api/v1/attachments/";
    private static final String OVER_LIMIT_BODY_MSG = "Request payload is too large.";
    private static final String MISSING_UPLOAD_LENGTH_MSG = "Uploads must declare a Content-Length.";
    private static final String UNSUPPORTED_MEDIA_TYPE_MSG = "Unsupported Media Type.";

    private final RateLimiter rateLimiter;
    private final ObjectMapper objectMapper;
    private final int publicReadMaxRequests;
    private final Duration publicReadWindow;
    private final int publicWriteMaxRequests;
    private final Duration publicWriteWindow;
    private final long publicWriteMaxBodyBytes;
    private final int uploadMaxRequests;
    private final Duration uploadWindow;
    private final long uploadMaxDeclaredBytes;
    private final int downloadMaxRequests;
    private final Duration downloadWindow;

    public RateLimitFilter(
            RateLimiter rateLimiter,
            ObjectMapper objectMapper,
            @Value("${app.rate-limit.public-read-max-requests:120}") int publicReadMaxRequests,
            @Value("${app.rate-limit.public-read-window-seconds:60}") long publicReadWindowSeconds,
            @Value("${app.rate-limit.public-write-max-requests:20}") int publicWriteMaxRequests,
            @Value("${app.rate-limit.public-write-window-seconds:60}") long publicWriteWindowSeconds,
            @Value("${app.rate-limit.public-write-max-body-bytes:5242880}") long publicWriteMaxBodyBytes,
            @Value("${app.rate-limit.upload-max-requests:20}") int uploadMaxRequests,
            @Value("${app.rate-limit.upload-window-seconds:60}") long uploadWindowSeconds,
            @Value("${app.rate-limit.download-max-requests:600}") int downloadMaxRequests,
            @Value("${app.rate-limit.download-window-seconds:60}") long downloadWindowSeconds,
            @Value("${spring.servlet.multipart.max-request-size:30MB}") String maxRequestSize) {
        this.rateLimiter = rateLimiter;
        this.objectMapper = objectMapper;
        this.publicReadMaxRequests = publicReadMaxRequests;
        this.publicReadWindow = Duration.ofSeconds(publicReadWindowSeconds);
        this.publicWriteMaxRequests = publicWriteMaxRequests;
        this.publicWriteWindow = Duration.ofSeconds(publicWriteWindowSeconds);
        this.publicWriteMaxBodyBytes = publicWriteMaxBodyBytes;
        this.uploadMaxRequests = uploadMaxRequests;
        this.uploadWindow = Duration.ofSeconds(uploadWindowSeconds);
        this.downloadMaxRequests = downloadMaxRequests;
        this.downloadWindow = Duration.ofSeconds(downloadWindowSeconds);
        // Same ceiling the multipart parser enforces, derived rather than duplicated: a
        // self-hoster who raises ATTACHMENT_MAX_REQUEST_SIZE must not silently hit a second,
        // stale limit in the filter.
        this.uploadMaxDeclaredBytes = DataSize.parse(maxRequestSize).toBytes();
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

        RateLimiter.Decision decision;
        if (verdict.perCaller()) {
            // Uploads consume two budgets: the address (shared NAT) and the identified
            // caller (one account). Either refusing refuses the request.
            RateLimiter.Decision ipDecision =
                    rateLimiter.allowRequest(verdict.bucketPrefix() + ip, verdict.maxRequests(), verdict.window());
            UUID callerId = authenticatedCallerId();
            RateLimiter.Decision callerDecision = callerId == null
                    ? ipDecision
                    : rateLimiter.allowRequest("upload:" + callerId, verdict.maxRequests(), verdict.window());
            decision = ipDecision.allowed() ? callerDecision : ipDecision;
        } else if (verdict.useDefaultBudget()) {
            decision = rateLimiter.allowRequest(verdict.bucketPrefix() + ip);
        } else {
            decision = rateLimiter.allowRequest(verdict.bucketPrefix() + ip, verdict.maxRequests(), verdict.window());
        }

        if (!decision.allowed()) {
            String maskedIp = maskIp(ip);
            log.warn("Rate limit exceeded for IP: {}", maskedIp);
            // Advertising the window length would park a well-behaved client far longer
            // than it needs to wait - buckets refill greedily, so the next token is due
            // much sooner - and the realtime backoff sleeps for this value verbatim.
            response.setHeader("Retry-After", String.valueOf(decision.retryAfterSeconds()));
            writeError(response, 429, ErrorCode.RATE_LIMIT_EXCEEDED.defaultMessage());
            return;
        }

        // The anonymous PATCH endpoint only accepts JSON, and the bounded replay
        // below only replaces the byte stream: form/multipart bodies are parsed
        // via getParameter/getParts instead, so they would bypass the byte
        // ceiling. Reject non-JSON before any body is read or parsed.
        if (verdict.maxBodyBytes() > 0 && !isJsonContentType(request.getContentType())) {
            log.warn("Rejected non-JSON anonymous write from IP: {}", maskIp(ip));
            writeError(response, HttpServletResponse.SC_UNSUPPORTED_MEDIA_TYPE, UNSUPPORTED_MEDIA_TYPE_MSG);
            return;
        }

        // Checked after the budget so oversized requests cannot be used to probe the
        // endpoint for free, and before the body is parsed so a declared-oversized
        // payload never reaches the JSON parser, the base64 decoder, or the multipart
        // parser that would otherwise buffer it to disk.
        if (exceedsDeclaredBodyLimit(request, verdict)) {
            log.warn(
                    "Rejected oversized {} from IP: {}",
                    verdict.perCaller() ? "upload" : "anonymous write",
                    maskIp(ip));
            // An oversized upload is the same event the multipart ceiling reports, so it
            // carries the same message; an anonymous write is a JSON snapshot, not a file.
            writeError(
                    response,
                    413,
                    verdict.perCaller() ? ErrorCode.PAYLOAD_TOO_LARGE.defaultMessage() : OVER_LIMIT_BODY_MSG);
            return;
        }

        // A multipart upload cannot be bounded by reading the stream: the parser consumes the
        // same body through request.getParts(), off the original request, so a filter read
        // would leave it nothing to parse. A missing declared length can only come from a
        // non-browser client (FormData always sets Content-Length), so reject it before the
        // container spools an unbounded chunked body to temp files. Non-multipart bodies
        // cannot be spooled this way and fall through to their own handling.
        if (verdict.perCaller()
                && request.getContentLengthLong() < 0
                && isMultipartContentType(request.getContentType())) {
            log.warn("Rejected upload without a declared Content-Length from IP: {}", maskIp(ip));
            writeError(response, 413, MISSING_UPLOAD_LENGTH_MSG);
            return;
        }

        // The declared length is absent on chunked uploads, so it cannot bound
        // them: read up to one byte past the ceiling and reject there. Smaller
        // bodies are replayed downstream from the cache, so the handler still
        // sees the full payload while no request ever buffers more than the
        // ceiling plus one byte before parsing.
        if (verdict.maxBodyBytes() > 0) {
            HttpServletRequest bounded = readBoundedBody(request, verdict.maxBodyBytes());
            if (bounded == null) {
                log.warn("Rejected oversized anonymous write from IP: {}", maskIp(ip));
                writeError(response, 413, OVER_LIMIT_BODY_MSG);
                return;
            }
            filterChain.doFilter(bounded, response);
            return;
        }

        filterChain.doFilter(request, response);
    }

    /**
     * The anonymous PATCH endpoint only accepts JSON. A missing content type
     * is allowed through to the byte-bound read (containers only pre-parse
     * form bodies when the type says so); a present but non-JSON type is
     * rejected so form/multipart parsing cannot bypass the body ceiling.
     */
    private boolean isJsonContentType(String contentType) {
        if (contentType == null || contentType.isBlank()) {
            return true;
        }
        String mime = contentType.split(";", 2)[0].trim().toLowerCase(java.util.Locale.ROOT);
        return mime.equals(MediaType.APPLICATION_JSON_VALUE)
                || (mime.startsWith("application/") && mime.endsWith("+json"));
    }

    /**
     * Content-Length pre-check: for anonymous writes it mirrors the buffering ceiling; for
     * uploads it mirrors the multipart request limit, so a body that large is refused
     * before the container spills it to a temp file. A request without a declared length
     * (chunked) is bounded by {@link #readBoundedBody} for anonymous writes; uploads reject
     * it outright, since the multipart parser cannot read a filter-consumed stream.
     */
    /** True for the only content type the container spools to disk: multipart form uploads. */
    private static boolean isMultipartContentType(String contentType) {
        if (contentType == null) {
            return false;
        }
        String mime = contentType.split(";", 2)[0].trim().toLowerCase(java.util.Locale.ROOT);
        return mime.equals(MediaType.MULTIPART_FORM_DATA_VALUE);
    }

    private boolean exceedsDeclaredBodyLimit(HttpServletRequest request, Verdict verdict) {
        long limit = verdict.declaredLimitBytes();
        if (limit <= 0) {
            return false;
        }
        long declaredLength = request.getContentLengthLong();
        return declaredLength > limit;
    }

    /**
     * Reads at most {@code maxBodyBytes + 1} bytes of the request body. Returns a
     * request replaying the cached bytes, or null when the body exceeds the ceiling.
     */
    private HttpServletRequest readBoundedBody(HttpServletRequest request, long maxBodyBytes) throws IOException {
        java.io.InputStream in = request.getInputStream();
        java.io.ByteArrayOutputStream cached = new java.io.ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        long total = 0;
        int read;
        while ((read = in.read(buffer)) != -1) {
            total += read;
            if (total > maxBodyBytes) {
                return null;
            }
            cached.write(buffer, 0, read);
        }
        return new CachedBodyRequest(request, cached.toByteArray());
    }

    /** Replays a cached request body downstream after bound checking. */
    private static class CachedBodyRequest extends jakarta.servlet.http.HttpServletRequestWrapper {
        private final byte[] body;

        CachedBodyRequest(HttpServletRequest request, byte[] body) {
            super(request);
            this.body = body;
        }

        @Override
        public jakarta.servlet.ServletInputStream getInputStream() {
            java.io.ByteArrayInputStream bytes = new java.io.ByteArrayInputStream(body);
            return new jakarta.servlet.ServletInputStream() {
                @Override
                public int read() {
                    return bytes.read();
                }

                @Override
                public boolean isFinished() {
                    return bytes.available() == 0;
                }

                @Override
                public boolean isReady() {
                    return true;
                }

                @Override
                public void setReadListener(jakarta.servlet.ReadListener listener) {
                    // Blocking reads only; async IO is not used on this path.
                }
            };
        }

        @Override
        public java.io.BufferedReader getReader() throws IOException {
            String encoding = getCharacterEncoding() != null ? getCharacterEncoding() : "UTF-8";
            return new java.io.BufferedReader(new java.io.InputStreamReader(getInputStream(), encoding));
        }

        @Override
        public int getContentLength() {
            return body.length;
        }

        @Override
        public long getContentLengthLong() {
            return body.length;
        }
    }

    private void writeError(HttpServletResponse response, int status, String message) throws IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write(objectMapper.writeValueAsString(ApiResponse.error(message)));
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

        // Signed-URL issuance and the signed download are reachable anonymously, so they
        // must not fall through to `unlimited` (the document-path check below).
        if (uri.startsWith(ATTACHMENT_PATH_PREFIX)) {
            // Downloads (including every range seek) and anonymous mints share a larger
            // bucket so one document open - a hundred-image doc mints ~100 URLs in a ~2s
            // burst - or a video scrub cannot exhaust the read budget that also serves
            // share-link browsing. Two tabs behind one NAT double that burst.
            if (isSignedDownload(request)) {
                return Verdict.customBudget("download:", downloadMaxRequests, downloadWindow);
            }
            if (isSignedUrlMint(request)) {
                // Minting is permission-checked and, for a verified caller, as cheap to
                // trust as access-check below; anonymous mints join the download budget
                // because browser media tags cannot send an Authorization header.
                if (isAuthenticatedCaller()) {
                    return Verdict.unlimited();
                }
                return Verdict.customBudget("download:", downloadMaxRequests, downloadWindow);
            }
            return Verdict.customBudget("public-read:", publicReadMaxRequests, publicReadWindow);
        }

        if (!uri.startsWith(PUBLIC_DOCUMENT_PATH_PREFIX)) {
            return Verdict.unlimited();
        }

        String middle = uri.substring(PUBLIC_DOCUMENT_PATH_PREFIX.length());

        String decodedMiddle;
        try {
            decodedMiddle = UriUtils.decode(middle, StandardCharsets.UTF_8);
        } catch (IllegalArgumentException ignored) {
            return Verdict.customBudget("public-read:", publicReadMaxRequests, publicReadWindow);
        }

        if (decodedMiddle.isBlank() || decodedMiddle.contains("%")) {
            return Verdict.customBudget("public-read:", publicReadMaxRequests, publicReadWindow);
        }

        // Strip trailing slash(es) so /public/ matches /public
        while (decodedMiddle.endsWith("/")) {
            decodedMiddle = decodedMiddle.substring(0, decodedMiddle.length() - 1);
        }
        if (decodedMiddle.isBlank()) {
            return Verdict.customBudget("public-read:", publicReadMaxRequests, publicReadWindow);
        }

        String method = request.getMethod();
        String[] parts = decodedMiddle.split("/");
        if (!parts[0].isBlank() && parts.length == 2 && parts[1].equals("public")) {
            // Match /api/v1/documents/{id}/public for reads (GET) and
            // anonymous share-link saves (PATCH).
            if ("PATCH".equalsIgnoreCase(method)) {
                return Verdict.anonymousWriteBudget(
                        "public-write:", publicWriteMaxRequests, publicWriteWindow, publicWriteMaxBodyBytes);
            }
            if ("GET".equalsIgnoreCase(method) || "HEAD".equalsIgnoreCase(method)) {
                return Verdict.customBudget("public-read:", publicReadMaxRequests, publicReadWindow);
            }
            return Verdict.unlimited();
        }

        // Match exactly POST /api/v1/documents/{id}/attachments. This is the one
        // authenticated write that can consume unbounded disk, so it is throttled per
        // caller and per address instead of falling through to unlimited.
        if ("POST".equalsIgnoreCase(method)
                && parts.length == 2
                && !parts[0].isBlank()
                && parts[1].equals("attachments")) {
            return Verdict.uploadBudget(uploadMaxRequests, uploadWindow, uploadMaxDeclaredBytes);
        }

        if (!"GET".equalsIgnoreCase(method) && !"HEAD".equalsIgnoreCase(method)) {
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

    /** Exactly {@code GET|HEAD /api/v1/attachments/{id}/file}, no nested or trailing segments. */
    private static boolean isSignedDownload(HttpServletRequest request) {
        String method = request.getMethod();
        if (!"GET".equalsIgnoreCase(method) && !"HEAD".equalsIgnoreCase(method)) {
            return false;
        }
        String remainder = request.getRequestURI().substring(ATTACHMENT_PATH_PREFIX.length());
        return remainder.endsWith("/file") && remainder.indexOf('/') == remainder.length() - 5;
    }

    /** Exactly {@code GET|HEAD /api/v1/attachments/{id}/url}, no nested or trailing segments. */
    private static boolean isSignedUrlMint(HttpServletRequest request) {
        String method = request.getMethod();
        if (!"GET".equalsIgnoreCase(method) && !"HEAD".equalsIgnoreCase(method)) {
            return false;
        }
        String remainder = request.getRequestURI().substring(ATTACHMENT_PATH_PREFIX.length());
        return remainder.endsWith("/url") && remainder.indexOf('/') == remainder.length() - 4;
    }

    private boolean isAuthenticatedCaller() {
        return authenticatedCallerId() != null;
    }

    /** Id of the verified JWT principal, or null when the request is anonymous. */
    private UUID authenticatedCallerId() {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated() || !(auth.getPrincipal() instanceof UserPrincipal principal)) {
            return null;
        }
        return principal.getId();
    }

    /**
     * Throttling decision for one request: which bucket key prefix applies and
     * with what budget. {@code useDefaultBudget} keeps the legacy 20/min
     * behavior (auth endpoints); custom budgets are configured per category.
     */
    private record Verdict(
            boolean limited,
            String bucketPrefix,
            boolean useDefaultBudget,
            int maxRequests,
            Duration window,
            long maxBodyBytes,
            long declaredLimitBytes,
            boolean perCaller) {
        static Verdict unlimited() {
            return new Verdict(false, "", true, 0, Duration.ZERO, 0, 0, false);
        }

        static Verdict defaultBudget(String bucketPrefix) {
            return new Verdict(
                    true,
                    bucketPrefix,
                    true,
                    RateLimiter.DEFAULT_MAX_REQUESTS,
                    RateLimiter.DEFAULT_WINDOW,
                    0,
                    0,
                    false);
        }

        static Verdict customBudget(String bucketPrefix, int maxRequests, Duration window) {
            return new Verdict(true, bucketPrefix, false, maxRequests, window, 0, 0, false);
        }

        static Verdict anonymousWriteBudget(String bucketPrefix, int maxRequests, Duration window, long maxBodyBytes) {
            return new Verdict(true, bucketPrefix, false, maxRequests, window, maxBodyBytes, maxBodyBytes, false);
        }

        /** Declared-size ceiling only: the body is never read or buffered by the filter. */
        static Verdict uploadBudget(int maxRequests, Duration window, long declaredLimitBytes) {
            return new Verdict(true, "upload-ip:", false, maxRequests, window, 0, declaredLimitBytes, true);
        }
    }

    /**
     * Client address used as the rate-limit bucket key.
     *
     * X-Forwarded-For is client-supplied until a trusted hop appends the peer address
     * to it, so the leftmost entry is spoofable: rotating it would hand every request a
     * fresh budget. Read the list right to left instead - skipping the hops our own
     * infrastructure appended (the trusted proxies) - and use the first address that is
     * not a trusted proxy. The trusted list must only contain proxies; a CIDR that also
     * covers real clients would let those clients spoof the entry we stop at.
     */
    private String resolveClientIp(HttpServletRequest request) {
        String remoteAddr = normalizeIp(request.getRemoteAddr());
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded == null || forwarded.isBlank() || !isTrustedProxy(request.getRemoteAddr())) {
            return remoteAddr;
        }

        String[] hops = forwarded.split(",");
        for (int i = hops.length - 1; i >= 0; i--) {
            String candidate = normalizeIp(hops[i].trim());
            // A garbage hop must not become the bucket key (or be forwarded):
            // skip anything that is not an IP literal and fall back to the peer.
            if (!candidate.isEmpty() && isIpLiteral(candidate) && !isTrustedProxy(candidate)) {
                return candidate;
            }
        }
        // Every hop was a trusted proxy (or the header was empty): key on the peer.
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

    /**
     * True for IPv4 dotted quads and IPv6 literals (which always contain a colon).
     * Hostnames and garbage never come from a proxy's appended peer address, so
     * they are skipped rather than keying a rate-limit bucket. Colon alone is
     * not enough: garbage like "abc:def" must not become a bucket key.
     */
    private static boolean isIpLiteral(String candidate) {
        if (candidate.contains(":")) {
            // IPv6 hex digits, colons, dots (IPv4-mapped) and zone ids only.
            for (int i = 0; i < candidate.length(); i++) {
                char c = candidate.charAt(i);
                if (c == ':' || c == '.' || c == '%') {
                    continue;
                }
                if (Character.digit(c, 16) == -1) {
                    return false;
                }
            }
            return true;
        }
        String[] octets = candidate.split("\\.", -1);
        if (octets.length != 4) {
            return false;
        }
        for (String octet : octets) {
            if (octet.isEmpty() || octet.length() > 3) {
                return false;
            }
            for (int i = 0; i < octet.length(); i++) {
                if (!Character.isDigit(octet.charAt(i))) {
                    return false;
                }
            }
            if (Integer.parseInt(octet) > 255) {
                return false;
            }
        }
        return true;
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
