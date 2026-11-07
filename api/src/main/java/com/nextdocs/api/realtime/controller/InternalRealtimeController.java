package com.nextdocs.api.realtime.controller;

import com.nextdocs.api.auth.security.JwtTokenProvider;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.common.response.ApiResponse;
import com.nextdocs.api.document.dto.response.DocumentAccessResponse;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.service.DocumentSharingService;
import com.nextdocs.api.realtime.dto.response.InternalAccessResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/internal/realtime")
@Tag(name = "Internal Realtime", description = "Internal service APIs for Yhub realtime server")
public class InternalRealtimeController {

    private static final Logger log = LoggerFactory.getLogger(InternalRealtimeController.class);

    /**
     * The value shipped in application.properties. It is public, so accepting it would
     * let anyone with the source read every document through this endpoint.
     */
    private static final String PUBLISHED_DEV_TOKEN = "dev-yhub-service-token";

    private static final int MIN_TOKEN_BYTES = 32;

    /**
     * Yhub compacts on a timer and fires one notification per document that changed.
     * A bulk import compacts many documents back to back, and a row write per document
     * per tick would be pure amplification — nothing reads updated_at more precisely
     * than a few seconds. The first notification in the window wins.
     */
    private static final long CONTENT_UPDATED_THROTTLE_NANOS =
            Duration.ofSeconds(5).toNanos();

    /** A public-facing instance must not grow per-document state without a bound. */
    private static final int CONTENT_UPDATED_MAX_ENTRIES = 10_000;

    private final String serviceToken;
    private final DocumentSharingService sharingService;
    private final JwtTokenProvider jwtTokenProvider;
    private final DocumentRepository documentRepository;
    private final ConcurrentHashMap<UUID, Long> contentUpdatedAt = new ConcurrentHashMap<>();

    public InternalRealtimeController(
            @Value("${app.yhub.service-token}") String serviceToken,
            DocumentSharingService sharingService,
            JwtTokenProvider jwtTokenProvider,
            DocumentRepository documentRepository) {
        if (serviceToken == null
                || serviceToken.isBlank()
                || PUBLISHED_DEV_TOKEN.equals(serviceToken)
                || serviceToken.getBytes(StandardCharsets.UTF_8).length < MIN_TOKEN_BYTES) {
            throw new IllegalStateException("app.yhub.service-token must be a unique secret of at least "
                    + MIN_TOKEN_BYTES + " bytes shared with the realtime service; the published default is rejected.");
        }
        this.serviceToken = serviceToken;
        this.sharingService = sharingService;
        this.jwtTokenProvider = jwtTokenProvider;
        this.documentRepository = documentRepository;
    }

    @Operation(summary = "Resolve effective document access for Yhub auth plugin")
    @GetMapping("/access")
    public ResponseEntity<ApiResponse<InternalAccessResponse>> resolveAccess(
            @RequestParam("documentId") UUID documentId,
            @RequestHeader(value = "X-Yhub-Service", required = false) String serviceHeader,
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {

        if (!tokenMatches(serviceHeader)) {
            log.debug("Rejected internal access call with an invalid service header");
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(ApiResponse.error("FORBIDDEN", "Invalid or missing X-Yhub-Service header"));
        }

        try {
            if (authorization != null && !authorization.isBlank()) {
                String token = authorization.stripLeading();
                if (token.regionMatches(true, 0, "Bearer ", 0, 7)) {
                    token = token.substring(7).trim();
                }
                if (!jwtTokenProvider.isTokenValid(token)) {
                    throw new ApiException(ErrorCode.TOKEN_INVALID);
                }
                UUID userId = jwtTokenProvider.extractUserId(token);
                DocumentAccessResponse access = sharingService.accessCheck(userId, documentId);
                if (access.trashed()) {
                    return ResponseEntity.ok(ApiResponse.ok(new InternalAccessResponse(userId, null, true, false)));
                }
                return ResponseEntity.ok(ApiResponse.ok(
                        new InternalAccessResponse(userId, access.accessLevel(), access.trashed(), access.allowed())));
            } else {
                DocumentAccessResponse access = sharingService.accessCheckPublic(documentId);
                return ResponseEntity.ok(ApiResponse.ok(
                        new InternalAccessResponse(null, access.accessLevel(), access.trashed(), access.allowed())));
            }
        } catch (ApiException e) {
            if (e.getErrorCode() == ErrorCode.TOKEN_INVALID) {
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                        .body(ApiResponse.error(e.getErrorCode().name(), e.getMessage()));
            }
            if (e.getErrorCode() == ErrorCode.NOT_FOUND) {
                return ResponseEntity.ok(ApiResponse.ok(InternalAccessResponse.denied(false)));
            }
            throw e;
        }
    }

    /**
     * Records that Yhub persisted new content for a document, so the sidebar sort key
     * follows real edits. Deliberately narrow: it moves {@code updated_at} and nothing
     * else. Content still reaches Postgres only through the projection.
     */
    @Operation(summary = "Record that Yhub persisted new content for a document")
    @PostMapping("/content-updated")
    public ResponseEntity<ApiResponse<Void>> contentUpdated(
            @RequestParam("documentId") UUID documentId,
            @RequestHeader(value = "X-Yhub-Service", required = false) String serviceHeader) {

        if (!tokenMatches(serviceHeader)) {
            log.debug("Rejected internal content-updated call with an invalid service header");
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(ApiResponse.error("FORBIDDEN", "Invalid or missing X-Yhub-Service header"));
        }

        long now = System.nanoTime();
        Long previous = contentUpdatedAt.get(documentId);
        if (previous != null && now - previous < CONTENT_UPDATED_THROTTLE_NANOS) {
            return ResponseEntity.ok(ApiResponse.<Void>ok(null));
        }
        if (contentUpdatedAt.size() >= CONTENT_UPDATED_MAX_ENTRIES) {
            // Bounded reset rather than an LRU: the map only suppresses redundant writes,
            // so losing it costs one extra UPDATE per document at worst.
            contentUpdatedAt.clear();
        }
        contentUpdatedAt.put(documentId, now);

        documentRepository.markContentUpdated(documentId, OffsetDateTime.now(ZoneOffset.UTC));
        return ResponseEntity.ok(ApiResponse.<Void>ok(null));
    }

    /** Constant-time comparison; the length difference alone is not a secret. */
    private boolean tokenMatches(String provided) {
        if (provided == null) {
            return false;
        }
        return MessageDigest.isEqual(
                provided.getBytes(StandardCharsets.UTF_8), serviceToken.getBytes(StandardCharsets.UTF_8));
    }
}
