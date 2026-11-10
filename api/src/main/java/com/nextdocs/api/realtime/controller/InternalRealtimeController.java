package com.nextdocs.api.realtime.controller;

import com.nextdocs.api.auth.security.JwtTokenProvider;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.common.response.ApiResponse;
import com.nextdocs.api.document.dto.response.DocumentAccessResponse;
import com.nextdocs.api.document.service.DocumentSharingService;
import com.nextdocs.api.realtime.dto.response.InternalAccessResponse;
import com.nextdocs.api.realtime.service.ContentUpdatedThrottle;
import com.nextdocs.api.workspace.service.WorkspaceAccessService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;
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

    private final String serviceToken;
    private final DocumentSharingService sharingService;
    private final JwtTokenProvider jwtTokenProvider;
    private final WorkspaceAccessService workspaceAccessService;
    private final ContentUpdatedThrottle contentUpdatedThrottle;

    public InternalRealtimeController(
            @Value("${app.yhub.service-token}") String serviceToken,
            DocumentSharingService sharingService,
            JwtTokenProvider jwtTokenProvider,
            WorkspaceAccessService workspaceAccessService,
            ContentUpdatedThrottle contentUpdatedThrottle) {
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
        this.workspaceAccessService = workspaceAccessService;
        this.contentUpdatedThrottle = contentUpdatedThrottle;
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

        // The throttle owns the window, the deferred set and its scheduled flush; the
        // request handler only records the notification.
        contentUpdatedThrottle.record(documentId);
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
