package com.nextdocs.api.document.controller;

import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.security.JwtTokenProvider;
import com.nextdocs.api.auth.security.UserPrincipal;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.dto.response.DocumentAccessResponse;
import com.nextdocs.api.document.dto.response.DocumentContentResponse;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.service.DocumentSharingService;
import com.nextdocs.api.realtime.service.DocumentContentService;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import com.nextdocs.api.workspace.service.WorkspaceAccessService;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(DocumentContentController.class)
@Import({
    com.nextdocs.api.auth.security.SecurityConfig.class,
    com.nextdocs.api.common.cache.CaffeineCacheStore.class,
    com.nextdocs.api.auth.security.ratelimit.InMemoryRateLimiter.class
})
class DocumentContentControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private DocumentContentService contentService;

    @MockitoBean
    private DocumentSharingService sharingService;

    @MockitoBean
    private WorkspaceAccessService workspaceAccessService;

    @MockitoBean
    private JwtTokenProvider jwtTokenProvider;

    @MockitoBean
    private WorkspaceMemberRepository workspaceMemberRepository;

    private UserPrincipal principal;
    private UUID userId;
    private UUID documentId;

    @BeforeEach
    void setUp() {
        userId = UUID.randomUUID();
        documentId = UUID.randomUUID();
        principal = UserPrincipal.from(User.builder()
                .id(userId)
                .email("alice@example.com")
                .displayName("Alice")
                .passwordHash("$2a$12$hash")
                .build());
    }

    @Test
    void get_unauthenticated_returns401() throws Exception {
        mockMvc.perform(get("/api/v1/documents/{id}/content", documentId)).andExpect(status().isUnauthorized());
    }

    @Test
    void get_allowed_returnsContent() throws Exception {
        when(sharingService.getMyAccess(userId, documentId))
                .thenReturn(new DocumentAccessResponse(documentId, true, DocumentAccessLevel.VIEW, false, false));
        when(contentService.read(documentId)).thenReturn(new DocumentContentResponse("AQID"));

        mockMvc.perform(get("/api/v1/documents/{id}/content", documentId).with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.content").value("AQID"));
    }

    @Test
    void get_trashedWithoutIncludeFlag_returns404() throws Exception {
        when(sharingService.getMyAccess(userId, documentId))
                .thenReturn(new DocumentAccessResponse(documentId, true, DocumentAccessLevel.EDIT, false, true));

        mockMvc.perform(get("/api/v1/documents/{id}/content", documentId).with(user(principal)))
                .andExpect(status().isNotFound());

        verifyNoInteractions(contentService);
    }

    @Test
    void get_trashedWithIncludeFlag_returnsContent() throws Exception {
        when(sharingService.getMyAccess(userId, documentId))
                .thenReturn(new DocumentAccessResponse(documentId, true, DocumentAccessLevel.VIEW, false, true));
        when(contentService.read(documentId)).thenReturn(new DocumentContentResponse("AQID"));

        mockMvc.perform(get("/api/v1/documents/{id}/content", documentId)
                        .param("includeTrashed", "true")
                        .with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.content").value("AQID"));
    }

    @Test
    void get_yhubTransient_returns503() throws Exception {
        when(sharingService.getMyAccess(userId, documentId))
                .thenReturn(new DocumentAccessResponse(documentId, true, DocumentAccessLevel.VIEW, false, false));
        when(contentService.read(documentId)).thenThrow(new ApiException(ErrorCode.SERVICE_UNAVAILABLE));

        mockMvc.perform(get("/api/v1/documents/{id}/content", documentId).with(user(principal)))
                .andExpect(status().isServiceUnavailable());
    }

    @Test
    void getPublic_allowed_returnsContentWithoutAuthentication() throws Exception {
        when(sharingService.accessCheckPublic(documentId))
                .thenReturn(new DocumentAccessResponse(documentId, true, DocumentAccessLevel.VIEW, false, false));
        when(contentService.read(documentId)).thenReturn(new DocumentContentResponse("AQID"));

        mockMvc.perform(get("/api/v1/documents/{id}/public/content", documentId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.content").value("AQID"));
    }

    @Test
    void getPublic_disallowed_returns404() throws Exception {
        when(sharingService.accessCheckPublic(documentId))
                .thenReturn(new DocumentAccessResponse(documentId, false, null, false, false));

        mockMvc.perform(get("/api/v1/documents/{id}/public/content", documentId))
                .andExpect(status().isNotFound());

        verifyNoInteractions(contentService);
    }
}
