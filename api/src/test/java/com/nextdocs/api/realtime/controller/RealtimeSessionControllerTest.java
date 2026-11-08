package com.nextdocs.api.realtime.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.security.JwtTokenProvider;
import com.nextdocs.api.auth.security.UserPrincipal;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.dto.response.DocumentAccessResponse;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.service.DocumentSharingService;
import com.nextdocs.api.workspace.service.WorkspaceAccessService;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(RealtimeSessionController.class)
@Import({
    com.nextdocs.api.auth.security.SecurityConfig.class,
    com.nextdocs.api.common.cache.CaffeineCacheStore.class,
    com.nextdocs.api.auth.security.ratelimit.InMemoryRateLimiter.class
})
class RealtimeSessionControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private DocumentSharingService sharingService;

    @MockitoBean
    private JwtTokenProvider jwtTokenProvider;

    @MockitoBean
    private WorkspaceAccessService workspaceAccessService;

    @MockitoBean
    private com.nextdocs.api.workspace.repository.WorkspaceMemberRepository workspaceMemberRepository;

    @Test
    void deniesAccessWhenNotAllowed() throws Exception {
        UUID docId = UUID.randomUUID();
        when(sharingService.accessCheckPublic(eq(docId)))
                .thenReturn(new DocumentAccessResponse(docId, false, null, false, false));

        mockMvc.perform(post("/api/v1/documents/{id}/realtime-session", docId)).andExpect(status().isForbidden());
    }

    @Test
    void deniesAccessWhenTrashed() throws Exception {
        UUID docId = UUID.randomUUID();
        when(sharingService.accessCheckPublic(eq(docId)))
                .thenReturn(new DocumentAccessResponse(docId, true, DocumentAccessLevel.VIEW, false, true));

        mockMvc.perform(post("/api/v1/documents/{id}/realtime-session", docId)).andExpect(status().isForbidden());
    }

    @Test
    void returnsSessionAndAccessLevel() throws Exception {
        UUID docId = UUID.randomUUID();
        when(sharingService.accessCheckPublic(eq(docId)))
                .thenReturn(new DocumentAccessResponse(docId, true, DocumentAccessLevel.EDIT, false, false));

        mockMvc.perform(post("/api/v1/documents/{id}/realtime-session", docId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.wsUrl").value("ws://localhost:1234/api/ws/v1/nextdocs"))
                .andExpect(jsonPath("$.data.documentId").value(docId.toString()))
                .andExpect(jsonPath("$.data.accessLevel").value("EDIT"))
                // The old contract leaked client-side gates the server no longer honours.
                .andExpect(jsonPath("$.data.readOnly").doesNotExist())
                .andExpect(jsonPath("$.data.expiresAtEpochMs").doesNotExist());
    }

    @Test
    void returnsSessionForAnAuthenticatedCaller() throws Exception {
        UUID docId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        User user = User.builder()
                .id(userId)
                .email("member@example.com")
                .displayName("Member")
                .passwordHash("$2a$12$hash")
                .build();
        UserPrincipal principal = UserPrincipal.from(user);

        when(sharingService.accessCheck(eq(userId), eq(docId)))
                .thenReturn(new DocumentAccessResponse(docId, true, DocumentAccessLevel.VIEW, false, false));

        mockMvc.perform(post("/api/v1/documents/{id}/realtime-session", docId).with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.accessLevel").value("VIEW"));
    }

    @Test
    void deniesSessionWhenTheUserIsNoLongerAWorkspaceMember() throws Exception {
        UUID docId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        User user = User.builder()
                .id(userId)
                .email("removed@example.com")
                .displayName("Removed")
                .passwordHash("$2a$12$hash")
                .build();
        UserPrincipal principal = UserPrincipal.from(user);

        // Document ownership resolves without workspace membership, so the broker must
        // apply the outer gate before it can hand out an access level.
        doThrow(new ApiException(ErrorCode.NOT_FOUND))
                .when(workspaceAccessService)
                .requireMember(userId);

        mockMvc.perform(post("/api/v1/documents/{id}/realtime-session", docId).with(user(principal)))
                .andExpect(status().isNotFound());

        verify(sharingService, never()).accessCheck(any(), any());
    }
}
