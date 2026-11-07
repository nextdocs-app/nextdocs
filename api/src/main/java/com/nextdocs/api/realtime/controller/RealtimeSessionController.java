package com.nextdocs.api.realtime.controller;

import com.nextdocs.api.auth.security.BearerTokens;
import com.nextdocs.api.auth.security.UserPrincipal;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.common.response.ApiResponse;
import com.nextdocs.api.document.dto.response.DocumentAccessResponse;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.service.DocumentSharingService;
import com.nextdocs.api.realtime.client.YhubClient;
import com.nextdocs.api.realtime.dto.response.RealtimeSessionResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.net.URI;
import java.net.URISyntaxException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/documents")
@Tag(name = "Realtime Session", description = "Session broker for realtime collaboration")
public class RealtimeSessionController {

    private static final String WS_PATH = "/api/ws/v1/nextdocs";

    private final DocumentRepository documentRepository;
    private final DocumentSharingService sharingService;
    private final YhubClient yhubClient;
    private final String wsBaseUrl;

    public RealtimeSessionController(
            DocumentRepository documentRepository,
            DocumentSharingService sharingService,
            YhubClient yhubClient,
            @Value("${app.yhub.ws-url:}") String wsUrl,
            @Value("${app.web.base-url}") String webBaseUrl) {
        this.documentRepository = documentRepository;
        this.sharingService = sharingService;
        this.yhubClient = yhubClient;
        this.wsBaseUrl = resolveWsBaseUrl(wsUrl, webBaseUrl);
    }

    @Operation(summary = "Create or obtain a realtime collaboration session for a document")
    @PostMapping("/{id}/realtime-session")
    public ResponseEntity<ApiResponse<RealtimeSessionResponse>> createSession(
            @PathVariable UUID id,
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {

        DocumentAccessResponse access;
        if (principal == null) {
            BearerTokens.rejectInvalidBearer(authorization);
            access = sharingService.accessCheckPublic(id);
        } else {
            access = sharingService.accessCheck(principal.getId(), id);
        }

        if (!access.allowed() || access.trashed()) {
            throw new ApiException(ErrorCode.FORBIDDEN);
        }

        Document doc = documentRepository.findById(id).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));

        // An empty document has nothing to seed; recording it as seeded keeps the next
        // session from calling Yhub with an empty update.
        if (doc.getYhubSeededAt() == null) {
            byte[] state = doc.getYjsState();
            if (state == null || state.length == 0) {
                documentRepository.markYhubSeeded(id, OffsetDateTime.now(ZoneOffset.UTC));
            } else if (!yhubClient.seed(id, state)) {
                // Serving the session would open an empty document and let the client
                // overwrite the real snapshot on its first save.
                throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
            } else {
                documentRepository.markYhubSeeded(id, OffsetDateTime.now(ZoneOffset.UTC));
            }
        }

        RealtimeSessionResponse response = new RealtimeSessionResponse(wsBaseUrl, id.toString(), access.accessLevel());

        return ResponseEntity.ok(ApiResponse.ok(response));
    }

    /**
     * A session URL is handed to the browser, so it has to be one the browser will open.
     * A configured value wins; a blank one is derived from the public web origin, so a
     * TLS deployment that only sets the web URL still gets wss:// instead of a ws:// URL
     * the browser blocks as mixed content. Either way the scheme is checked at startup:
     * a typo must not turn every session into a silently broken socket.
     */
    static String resolveWsBaseUrl(String configured, String webBaseUrl) {
        String candidate = configured == null ? "" : configured.strip();
        if (candidate.isEmpty()) {
            candidate = deriveWsBaseUrl(webBaseUrl);
        }

        URI uri;
        try {
            uri = new URI(candidate);
        } catch (URISyntaxException e) {
            throw new IllegalStateException("app.yhub.ws-url is not a valid URI: " + candidate, e);
        }
        String scheme = uri.getScheme();
        if (!"ws".equals(scheme) && !"wss".equals(scheme)) {
            throw new IllegalStateException("app.yhub.ws-url must use ws:// or wss://, got: " + candidate);
        }
        if (uri.getHost() == null || uri.getHost().isEmpty()) {
            throw new IllegalStateException("app.yhub.ws-url must include a host: " + candidate);
        }
        return candidate.replaceAll("/+$", "");
    }

    private static String deriveWsBaseUrl(String webBaseUrl) {
        URI base;
        try {
            base = new URI(webBaseUrl == null ? "" : webBaseUrl.strip());
        } catch (URISyntaxException e) {
            throw new IllegalStateException("app.web.base-url is not a valid URI: " + webBaseUrl, e);
        }
        if (base.getScheme() == null || base.getRawAuthority() == null) {
            throw new IllegalStateException("app.web.base-url must be an absolute URL: " + webBaseUrl);
        }
        boolean tls = "https".equalsIgnoreCase(base.getScheme());
        String path = base.getPath() == null ? "" : base.getPath().replaceAll("/+$", "");
        return (tls ? "wss" : "ws") + "://" + base.getRawAuthority() + path + WS_PATH;
    }
}
