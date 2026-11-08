package com.nextdocs.api.realtime.controller;

import com.nextdocs.api.auth.security.JwtTokenProvider;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.common.response.ApiResponse;
import com.nextdocs.api.document.dto.response.DocumentAccessResponse;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.service.DocumentSharingService;
import com.nextdocs.api.realtime.dto.response.InternalAccessResponse;
import com.nextdocs.api.workspace.service.WorkspaceAccessService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.Scheduled;
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
    private final WorkspaceAccessService workspaceAccessService;
    private final ConcurrentHashMap<UUID, Long> contentUpdatedAt = new ConcurrentHashMap<>();
    /** Documents whose notification landed inside the throttle window, awaiting the flush. */
    private final Set<UUID> deferredContentUpdates = ConcurrentHashMap.newKeySet();

    public InternalRealtimeController(
            @Value("${app.yhub.service-token}") String serviceToken,
            DocumentSharingService sharingService,
            JwtTokenProvider jwtTokenProvider,
            DocumentRepository documentRepository,
            WorkspaceAccessService workspaceAccessService) {
        // Trim like the realtime service reads its copy: an env var or mounted secret
        // often carries a trailing newline, and an untrimmed value would never match.
        String normalizedToken = serviceToken == null ? null : serviceToken.trim();
        if (normalizedToken == null
                || normalizedToken.isBlank()
                || PUBLISHED_DEV_TOKEN.equals(normalizedToken)
                || normalizedToken.getBytes(StandardCharsets.UTF_8).length < MIN_TOKEN_BYTES) {
            throw new IllegalStateException("app.yhub.service-token must be a unique secret of at least "
                    + MIN_TOKEN_BYTES + " bytes shared with the realtime service; the published default is rejected.");
        }
        this.serviceToken = normalizedToken;
        this.sharingService = sharingService;
        this.jwtTokenProvider = jwtTokenProvider;
        this.documentRepository = documentRepository;
        this.workspaceAccessService = workspaceAccessService;
    }

    @Operation(summary = "Resolve effective document access for Yhub auth plugin")
    @GetMapping("/access")
    public ResponseEntity<ApiResponse<InternalAccessResponse>> resolveAccess(
            @RequestParam("documentId") UUID documentId,
            @RequestHeader(value = "X-Yhub-Service", required = false) String serviceHeader,
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {

        if (!tokenMatches(serviceHeader)) {
            // A bad service credential is a deployment fault, not a verdict on the caller:
            // answering 403 would let realtime read a rotated or half-applied secret as a
            // revocation and close every room with 4401. A 503 makes it retry instead, and
            // the WARN makes the misconfiguration visible; the header value is never logged.
            log.warn("Rejected internal access call with an invalid service header");
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(ApiResponse.error("SERVICE_UNAVAILABLE", "Invalid or missing X-Yhub-Service header"));
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
                // Membership is the outer gate: document ownership resolves on its own, so
                // a user removed from the workspace would otherwise keep writing through
                // every page they still own. NOT_FOUND masks as a definitive denial below.
                workspaceAccessService.requireMember(userId);
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
     * else. Content lives in Yhub and never enters Postgres.
     */
    @Operation(summary = "Record that Yhub persisted new content for a document")
    @PostMapping("/content-updated")
    public ResponseEntity<ApiResponse<Void>> contentUpdated(
            @RequestParam("documentId") UUID documentId,
            @RequestHeader(value = "X-Yhub-Service", required = false) String serviceHeader) {

        if (!tokenMatches(serviceHeader)) {
            // Same reasoning as the access route: a rejected credential is a fault to retry
            // and alert on, not a statement about the document.
            log.warn("Rejected internal content-updated call with an invalid service header");
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(ApiResponse.error("SERVICE_UNAVAILABLE", "Invalid or missing X-Yhub-Service header"));
        }

        long now = System.nanoTime();
        Long previous = contentUpdatedAt.get(documentId);
        if (previous != null && now - previous < CONTENT_UPDATED_THROTTLE_NANOS) {
            // Trailing edge: the last compaction of a burst must not be dropped, or the
            // sort key stays stale until the document is edited again. Remember it and
            // write once when the window closes.
            if (deferredContentUpdates.size() < CONTENT_UPDATED_MAX_ENTRIES) {
                deferredContentUpdates.add(documentId);
            }
            return ResponseEntity.ok(ApiResponse.<Void>ok(null));
        }
        writeContentUpdated(documentId, now);
        return ResponseEntity.ok(ApiResponse.<Void>ok(null));
    }

    /**
     * Flushes the notifications that arrived inside a throttle window.
     *
     * <p>The tick is cheap: the set only holds documents notified again before their
     * window closed, and an entry is written (and removed) on the first tick after that.
     */
    @Scheduled(fixedDelayString = "${app.yhub.content-updated-flush-interval-ms:1000}")
    void flushDeferredContentUpdates() {
        flushDeferredContentUpdates(System.nanoTime());
    }

    void flushDeferredContentUpdates(long nowNanos) {
        for (UUID documentId : deferredContentUpdates) {
            Long previous = contentUpdatedAt.get(documentId);
            if (previous != null && nowNanos - previous < CONTENT_UPDATED_THROTTLE_NANOS) {
                continue;
            }
            try {
                writeContentUpdated(documentId, nowNanos);
                deferredContentUpdates.remove(documentId);
            } catch (RuntimeException e) {
                // Stay deferred: the next tick retries rather than leaving the sort key
                // behind for good. Only the exception type is logged.
                log.warn(
                        "Deferred content-updated write failed for {}: {}",
                        documentId,
                        e.getClass().getSimpleName());
            }
        }
    }

    private void writeContentUpdated(UUID documentId, long nowNanos) {
        if (contentUpdatedAt.size() >= CONTENT_UPDATED_MAX_ENTRIES) {
            // Bounded reset rather than an LRU: the map only suppresses redundant writes,
            // so losing it costs one extra UPDATE per document at worst.
            contentUpdatedAt.clear();
        }
        documentRepository.markContentUpdated(documentId, OffsetDateTime.now(ZoneOffset.UTC));
        contentUpdatedAt.put(documentId, nowNanos);
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
