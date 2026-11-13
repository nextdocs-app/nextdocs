package com.nextdocs.api.realtime.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.nextdocs.api.auth.security.JwtTokenProvider;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.dto.response.DocumentAccessResponse;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.service.DocumentSharingService;
import com.nextdocs.api.realtime.dto.request.ContentUpdatedRequest;
import com.nextdocs.api.realtime.service.ContentUpdatedThrottle;
import com.nextdocs.api.search.config.SearchProperties;
import com.nextdocs.api.search.service.SearchIndexService;
import com.nextdocs.api.workspace.service.WorkspaceAccessService;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(InternalRealtimeController.class)
@Import({
    com.nextdocs.api.auth.security.SecurityConfig.class,
    com.nextdocs.api.common.cache.CaffeineCacheStore.class,
    com.nextdocs.api.auth.security.ratelimit.InMemoryRateLimiter.class,
    ContentUpdatedThrottle.class
})
class InternalRealtimeControllerTest {

    private static final String SERVICE_TOKEN = "test-yhub-service-token-0123456789abcdef";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private InternalRealtimeController controller;

    @Autowired
    private ContentUpdatedThrottle contentUpdatedThrottle;

    @MockitoBean
    private DocumentSharingService sharingService;

    @MockitoBean
    private JwtTokenProvider jwtTokenProvider;

    @MockitoBean
    private DocumentRepository documentRepository;

    @MockitoBean
    private WorkspaceAccessService workspaceAccessService;

    @MockitoBean
    private SearchIndexService searchIndexService;

    @MockitoBean
    private SearchProperties searchProperties;

    @MockitoBean
    private com.nextdocs.api.workspace.repository.WorkspaceMemberRepository workspaceMemberRepository;

    @Test
    void rejectsThePublishedDevelopmentServiceToken() {
        assertThrows(
                IllegalStateException.class,
                () -> new InternalRealtimeController(
                        "dev-yhub-service-token",
                        sharingService,
                        jwtTokenProvider,
                        workspaceAccessService,
                        contentUpdatedThrottle,
                        searchIndexService,
                        searchProperties));
        assertThrows(
                IllegalStateException.class,
                () -> new InternalRealtimeController(
                        "too-short",
                        sharingService,
                        jwtTokenProvider,
                        workspaceAccessService,
                        contentUpdatedThrottle,
                        searchIndexService,
                        searchProperties));
        assertThrows(
                IllegalStateException.class,
                () -> new InternalRealtimeController(
                        "   ",
                        sharingService,
                        jwtTokenProvider,
                        workspaceAccessService,
                        contentUpdatedThrottle,
                        searchIndexService,
                        searchProperties));
    }

    @Test
    void trimsWhitespaceAroundTheConfiguredServiceToken() {
        InternalRealtimeController trimmed = new InternalRealtimeController(
                "  " + SERVICE_TOKEN + "\n",
                sharingService,
                jwtTokenProvider,
                workspaceAccessService,
                contentUpdatedThrottle,
                searchIndexService,
                searchProperties);
        UUID docId = UUID.randomUUID();

        assertEquals(
                200,
                trimmed.contentUpdated(docId, null, SERVICE_TOKEN)
                        .getStatusCode()
                        .value());
        verify(documentRepository).markContentUpdated(eq(docId), any());
    }

    @Test
    void rejectsAnInvalidServiceHeaderAsATransientFailure() throws Exception {
        // A rotated or half-applied secret is a deployment fault: 403 would read as a
        // revocation in realtime and close every room with a permanent code.
        UUID docId = UUID.randomUUID();
        mockMvc.perform(get("/api/v1/internal/realtime/access").param("documentId", docId.toString()))
                .andExpect(status().isServiceUnavailable());

        mockMvc.perform(get("/api/v1/internal/realtime/access")
                        .param("documentId", docId.toString())
                        .header("X-Yhub-Service", "wrong-secret"))
                .andExpect(status().isServiceUnavailable());
    }

    @Test
    void resolvesPublicAccessForAnonymousUser() throws Exception {
        UUID docId = UUID.randomUUID();
        when(sharingService.accessCheckPublic(eq(docId)))
                .thenReturn(new DocumentAccessResponse(docId, true, DocumentAccessLevel.VIEW, false, false));

        mockMvc.perform(get("/api/v1/internal/realtime/access")
                        .param("documentId", docId.toString())
                        .header("X-Yhub-Service", SERVICE_TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.allowed").value(true))
                .andExpect(jsonPath("$.data.accessLevel").value("VIEW"))
                .andExpect(jsonPath("$.data.trashed").value(false));
    }

    @Test
    void resolvesAccessForAuthenticatedUser() throws Exception {
        UUID docId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        String token = "valid-token";

        when(jwtTokenProvider.isTokenValid(eq(token))).thenReturn(true);
        when(jwtTokenProvider.extractUserId(eq(token))).thenReturn(userId);
        when(sharingService.accessCheck(eq(userId), eq(docId)))
                .thenReturn(new DocumentAccessResponse(docId, true, DocumentAccessLevel.EDIT, false, false));

        mockMvc.perform(get("/api/v1/internal/realtime/access")
                        .param("documentId", docId.toString())
                        .header("X-Yhub-Service", SERVICE_TOKEN)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.allowed").value(true))
                .andExpect(jsonPath("$.data.userId").value(userId.toString()))
                .andExpect(jsonPath("$.data.accessLevel").value("EDIT"));
    }

    @Test
    void deniesAccessWhenTheUserIsNoLongerAWorkspaceMember() throws Exception {
        UUID docId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        String token = "valid-token";

        when(jwtTokenProvider.isTokenValid(eq(token))).thenReturn(true);
        when(jwtTokenProvider.extractUserId(eq(token))).thenReturn(userId);
        // Document ownership resolves without workspace membership, so the authorizer
        // must deny before the document-level check can grant it.
        when(workspaceAccessService.requireMember(eq(userId))).thenThrow(new ApiException(ErrorCode.NOT_FOUND));

        mockMvc.perform(get("/api/v1/internal/realtime/access")
                        .param("documentId", docId.toString())
                        .header("X-Yhub-Service", SERVICE_TOKEN)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.allowed").value(false))
                .andExpect(jsonPath("$.data.accessLevel").doesNotExist());

        verify(sharingService, never()).accessCheck(any(), any());
    }

    @Test
    void rejectsInvalidBearerToken() throws Exception {
        UUID docId = UUID.randomUUID();
        String token = "invalid-token";

        when(jwtTokenProvider.isTokenValid(eq(token))).thenReturn(false);

        mockMvc.perform(get("/api/v1/internal/realtime/access")
                        .param("documentId", docId.toString())
                        .header("X-Yhub-Service", SERVICE_TOKEN)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void contentUpdatedRejectsAnInvalidServiceHeader() throws Exception {
        mockMvc.perform(post("/api/v1/internal/realtime/content-updated")
                        .param("documentId", UUID.randomUUID().toString()))
                .andExpect(status().isServiceUnavailable());

        mockMvc.perform(post("/api/v1/internal/realtime/content-updated")
                        .param("documentId", UUID.randomUUID().toString())
                        .header("X-Yhub-Service", "wrong-secret"))
                .andExpect(status().isServiceUnavailable());

        verify(documentRepository, never()).markContentUpdated(any(), any());
    }

    @Test
    void contentUpdatedThrottlesRepeatedNotifications() throws Exception {
        UUID docId = UUID.randomUUID();

        for (int i = 0; i < 2; i++) {
            mockMvc.perform(post("/api/v1/internal/realtime/content-updated")
                            .param("documentId", docId.toString())
                            .header("X-Yhub-Service", SERVICE_TOKEN))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.success").value(true));
        }

        // Yhub fires once per changed document per compaction tick; a bulk import must not
        // turn that into a row write per document per tick.
        verify(documentRepository).markContentUpdated(eq(docId), any());

        // The trailing-edge flush lives in ContentUpdatedThrottle and is covered by its
        // own test: the controller only records the notification.
    }

    @Test
    void contentUpdatedIndexesExtractedText() throws Exception {
        UUID docId = UUID.randomUUID();
        when(searchProperties.getMaxContentBytes()).thenReturn(262144);

        mockMvc.perform(post("/api/v1/internal/realtime/content-updated")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"documentId\":\"" + docId + "\",\"text\":\"hello\",\"truncated\":true,"
                                + "\"producedAt\":\"2026-01-01T00:00:00Z\"}")
                        .header("X-Yhub-Service", SERVICE_TOKEN))
                .andExpect(status().isOk());

        verify(searchIndexService)
                .indexContent(eq(docId), eq("hello"), eq(true), eq(Instant.parse("2026-01-01T00:00:00Z")), any());
        verify(documentRepository).markContentUpdated(eq(docId), any());
    }

    @Test
    void contentUpdatedWithoutTextStillAdvancesTheContentVersion() {
        UUID docId = UUID.randomUUID();

        // A failed extraction and an older realtime build both send no text. The version
        // must still advance, or the crawl would wait for the age sweep to repair it.
        controller.contentUpdated(docId, null, SERVICE_TOKEN);

        verify(searchIndexService).recordContentVersion(eq(docId), any());
        verify(searchIndexService, never()).indexContent(any(), any(), anyBoolean(), any(), any());
    }

    @Test
    void contentUpdatedClipsAnOversizedProjectionAndFlagsIt() throws Exception {
        UUID docId = UUID.randomUUID();
        when(searchProperties.getMaxContentBytes()).thenReturn(4);

        // A rejected body would leave updated_at behind and the crawl would retry the same
        // rejected payload forever, so the boundary clips instead.
        mockMvc.perform(post("/api/v1/internal/realtime/content-updated")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"documentId\":\"" + docId + "\",\"text\":\"much too long\"}")
                        .header("X-Yhub-Service", SERVICE_TOKEN))
                .andExpect(status().isOk());

        verify(searchIndexService).indexContent(eq(docId), eq("much"), eq(true), any(), any());
    }

    @Test
    void contentUpdatedReindexDoesNotMoveTheSortKey() throws Exception {
        UUID docId = UUID.randomUUID();
        when(searchProperties.getMaxContentBytes()).thenReturn(262144);

        mockMvc.perform(post("/api/v1/internal/realtime/content-updated")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"documentId\":\"" + docId + "\",\"text\":\"hello\",\"reindex\":true}")
                        .header("X-Yhub-Service", SERVICE_TOKEN))
                .andExpect(status().isOk());

        verify(searchIndexService).indexContent(eq(docId), eq("hello"), eq(false), any(), any());
        // The crawl re-reads existing content; moving the sort key here would make the
        // document newer than the projection on every pass and the crawl would never end.
        verify(documentRepository, never()).markContentUpdated(eq(docId), any());
    }

    @Test
    void contentUpdatedStampsTheProjectionAndTheSortKeyWithOneInstant() {
        UUID docId = UUID.randomUUID();
        when(searchProperties.getMaxContentBytes()).thenReturn(262144);
        // A fresh throttle: the shared one may still hold this id inside its window.
        InternalRealtimeController fresh = new InternalRealtimeController(
                SERVICE_TOKEN,
                sharingService,
                jwtTokenProvider,
                workspaceAccessService,
                new ContentUpdatedThrottle(documentRepository),
                searchIndexService,
                searchProperties);

        fresh.contentUpdated(null, new ContentUpdatedRequest(docId, "hello", false, null, false), SERVICE_TOKEN);

        ArgumentCaptor<OffsetDateTime> sortKey = ArgumentCaptor.forClass(OffsetDateTime.class);
        ArgumentCaptor<Instant> projection = ArgumentCaptor.forClass(Instant.class);
        verify(documentRepository).markContentUpdated(eq(docId), sortKey.capture());
        verify(searchIndexService).indexContent(eq(docId), eq("hello"), eq(false), any(), projection.capture());
        // The crawl compares the two; a later sort key would make every edit look stale.
        assertEquals(sortKey.getValue().toInstant(), projection.getValue());
    }

    @Test
    void contentUpdatedRejectsTwoDifferentDocumentIds() throws Exception {
        UUID paramId = UUID.randomUUID();

        mockMvc.perform(post("/api/v1/internal/realtime/content-updated")
                        .param("documentId", paramId.toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"documentId\":\"" + UUID.randomUUID() + "\",\"text\":\"hello\"}")
                        .header("X-Yhub-Service", SERVICE_TOKEN))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(searchIndexService);
    }

    @Test
    void contentUpdatedRejectsAMalformedProducedAt() throws Exception {
        when(searchProperties.getMaxContentBytes()).thenReturn(262144);

        mockMvc.perform(post("/api/v1/internal/realtime/content-updated")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"documentId\":\"" + UUID.randomUUID() + "\",\"text\":\"hello\","
                                + "\"producedAt\":\"yesterday\"}")
                        .header("X-Yhub-Service", SERVICE_TOKEN))
                .andExpect(status().isBadRequest());
    }

    @Test
    void contentUpdatedRequiresADocumentId() throws Exception {
        mockMvc.perform(post("/api/v1/internal/realtime/content-updated")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}")
                        .header("X-Yhub-Service", SERVICE_TOKEN))
                .andExpect(status().isBadRequest());
    }

    @Test
    void contentUpdatedDoesNotThrottleAfterAFailedWrite() {
        UUID docId = UUID.randomUUID();
        InternalRealtimeController controller = new InternalRealtimeController(
                SERVICE_TOKEN,
                sharingService,
                jwtTokenProvider,
                workspaceAccessService,
                // A fresh throttle: this test needs an empty window for the failing write.
                new ContentUpdatedThrottle(documentRepository),
                searchIndexService,
                searchProperties);

        when(documentRepository.markContentUpdated(eq(docId), any()))
                .thenThrow(new IllegalStateException("database unavailable"))
                .thenReturn(1);

        assertThrows(IllegalStateException.class, () -> controller.contentUpdated(docId, null, SERVICE_TOKEN));
        controller.contentUpdated(docId, null, SERVICE_TOKEN);

        // The failed write must not start the throttle window: the next notification
        // still has to reach the repository.
        verify(documentRepository, times(2)).markContentUpdated(eq(docId), any());
    }
}
