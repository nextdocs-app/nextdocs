package com.nextdocs.api.mention.controller;

import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.nextdocs.api.mention.dto.response.MentionCandidateResponse;
import com.nextdocs.api.mention.service.MentionCandidateService;
import com.nextdocs.api.security.JwtTokenProvider;
import com.nextdocs.api.security.UserPrincipal;
import com.nextdocs.api.user.entity.User;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(DocumentMentionController.class)
@Import({
    com.nextdocs.api.security.SecurityConfig.class,
    com.nextdocs.api.common.cache.CaffeineCacheStore.class,
    com.nextdocs.api.security.ratelimit.InMemoryRateLimiter.class
})
class DocumentMentionControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private MentionCandidateService candidateService;

    @MockitoBean
    private JwtTokenProvider jwtTokenProvider;

    @MockitoBean
    private WorkspaceMemberRepository memberRepository;

    private UserPrincipal principal;
    private UUID userId;
    private UUID documentId;

    @BeforeEach
    void setUp() {
        User user = User.builder()
                .email("alice@example.com")
                .displayName("Alice")
                .passwordHash("$2a$12$hash")
                .build();
        userId = UUID.randomUUID();
        user.setId(userId);
        principal = UserPrincipal.from(user);
        documentId = UUID.randomUUID();
    }

    @Test
    void returnsCandidatesInTheApiEnvelope() throws Exception {
        UUID bobId = UUID.randomUUID();
        when(candidateService.search(userId, documentId, "bo", 5))
                .thenReturn(List.of(new MentionCandidateResponse(bobId, "bob@example.com", "Bob", null)));

        mockMvc.perform(get("/api/v1/documents/{documentId}/mentionable-users", documentId)
                        .param("q", "bo")
                        .param("limit", "5")
                        .with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data[0].userId").value(bobId.toString()))
                .andExpect(jsonPath("$.data[0].email").value("bob@example.com"))
                .andExpect(jsonPath("$.data[0].displayName").value("Bob"));
    }

    @Test
    void defaultsTheQueryAndLimitWhenOmitted() throws Exception {
        when(candidateService.search(userId, documentId, null, 20)).thenReturn(List.of());

        mockMvc.perform(get("/api/v1/documents/{documentId}/mentionable-users", documentId)
                        .with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").isArray())
                .andExpect(jsonPath("$.data").isEmpty());
    }

    @Test
    void requiresAuthentication() throws Exception {
        mockMvc.perform(get("/api/v1/documents/{documentId}/mentionable-users", documentId))
                .andExpect(status().isUnauthorized());

        verifyNoInteractions(candidateService);
    }
}
