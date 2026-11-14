package com.nextdocs.api.realtime.controller;

import com.nextdocs.api.auth.security.JwtTokenProvider;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.common.response.ApiResponse;
import com.nextdocs.api.document.dto.response.DocumentAccessResponse;
import com.nextdocs.api.document.service.DocumentSharingService;
import com.nextdocs.api.realtime.dto.request.ContentUpdatedRequest;
import com.nextdocs.api.realtime.dto.response.InternalAccessResponse;
import com.nextdocs.api.realtime.service.ContentUpdatedThrottle;
import com.nextdocs.api.search.config.SearchProperties;
import com.nextdocs.api.search.service.SearchIndexService;
import com.nextdocs.api.workspace.service.WorkspaceAccessService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
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
    private final SearchIndexService searchIndexService;
    private final SearchProperties searchProperties;

    public InternalRealtimeController(
            @Value("${app.yhub.service-token}") String serviceToken,
            DocumentSharingService sharingService,
            JwtTokenProvider jwtTokenProvider,
            WorkspaceAccessService workspaceAccessService,
            ContentUpdatedThrottle contentUpdatedThrottle,
            SearchIndexService searchIndexService,
            SearchProperties searchProperties) {
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
        this.searchIndexService = searchIndexService;
        this.searchProperties = searchProperties;
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
     * Records that Yhub persisted new content for a document: it moves the sidebar sort
     * key and, when the payload carries extracted text, refreshes the search projection.
     * Content still lives only in Yhub; the projection is capped plain text, never the
     * document body.
     *
     * <p>A body is optional. An older realtime build sends only the query parameter; a
     * newer one also sends the projection, so a rolling deploy is safe in both directions.
     */
    @Operation(summary = "Record that Yhub persisted new content for a document")
    @PostMapping("/content-updated")
    public ResponseEntity<ApiResponse<Void>> contentUpdated(
            @RequestParam(value = "documentId", required = false) UUID documentIdParam,
            @RequestBody(required = false) ContentUpdatedRequest body,
            @RequestHeader(value = "X-Yhub-Service", required = false) String serviceHeader) {

        if (!tokenMatches(serviceHeader)) {
            // Same reasoning as the access route: a rejected credential is a fault to retry
            // and alert on, not a statement about the document.
            log.warn("Rejected internal content-updated call with an invalid service header");
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(ApiResponse.error("SERVICE_UNAVAILABLE", "Invalid or missing X-Yhub-Service header"));
        }

        UUID bodyDocumentId = body == null ? null : body.documentId();
        if (bodyDocumentId != null && documentIdParam != null && !bodyDocumentId.equals(documentIdParam)) {
            // Two ids for one notification: refuse rather than silently pick one.
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "documentId must match the query parameter.");
        }
        UUID documentId = bodyDocumentId != null ? bodyDocumentId : documentIdParam;
        if (documentId == null) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "documentId is required.");
        }

        // One instant for the projection and the sort key. The reconcile crawl compares
        // the two, so stamping the sort key later would make every edit look stale and
        // the crawl would re-extract documents that this request just indexed.
        Instant now = Instant.now();

        // Index before touching the timestamp: a skipped throttle window must not skip
        // content. A missing or hard-deleted document is a no-op upsert, not an error.
        if (body != null && body.text() != null) {
            String text = body.text();
            boolean truncated = Boolean.TRUE.equals(body.truncated());
            int maxBytes = Math.max(0, searchProperties.getMaxContentBytes());
            byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
            if (bytes.length > maxBytes) {
                // The extractor caps at the same value, so a larger body means a
                // misconfigured sender. Clip on a code-point boundary instead of rejecting:
                // a 4xx here would leave updated_at behind and the crawl would retry the
                // same rejected body forever.
                int end = maxBytes;
                while (end > 0 && (bytes[end] & 0xC0) == 0x80) {
                    end--;
                }
                text = new String(bytes, 0, end, StandardCharsets.UTF_8);
                truncated = true;
            }
            searchIndexService.indexContent(documentId, text, truncated, parseProducedAt(body.producedAt()), now);
        } else {
            // Content moved without carrying text: extraction failed, or an older realtime
            // build sent only the timestamp. Advancing the known content version makes the
            // crawl re-read this document immediately, without waiting for the age sweep.
            searchIndexService.recordContentVersion(documentId, now);
        }

        // A reindex reads existing content; it is not an edit. Recording it would move the
        // sort key past the projection the crawl just wrote, so the same document would be
        // selected as stale on every pass and the crawl would never converge.
        if (body == null || !Boolean.TRUE.equals(body.reindex())) {
            // The throttle owns the window, the deferred set and its scheduled flush; the
            // request handler only records the notification.
            contentUpdatedThrottle.record(documentId, now);
        }
        return ResponseEntity.ok(ApiResponse.<Void>ok(null));
    }

    /**
     * The production time is optional so an older sender keeps working. A malformed value
     * is a contract error rather than "now": treating it as now could make a stale retry
     * look newer than the projection it must not overwrite.
     */
    private static Instant parseProducedAt(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return Instant.parse(raw.trim());
        } catch (DateTimeParseException e) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "producedAt must be an ISO-8601 instant.");
        }
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
