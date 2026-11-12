package com.nextdocs.api.search.controller;

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
import com.nextdocs.api.search.dto.response.SearchHitResponse;
import com.nextdocs.api.search.dto.response.SearchResponse;
import com.nextdocs.api.search.dto.response.SearchTextSegmentResponse;
import com.nextdocs.api.search.service.SearchService;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(SearchController.class)
@Import({
    com.nextdocs.api.auth.security.SecurityConfig.class,
    com.nextdocs.api.common.cache.CaffeineCacheStore.class,
    com.nextdocs.api.auth.security.ratelimit.InMemoryRateLimiter.class
})
class SearchControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private SearchService searchService;

    @MockitoBean
    private JwtTokenProvider jwtTokenProvider;

    @MockitoBean
    private WorkspaceMemberRepository memberRepository;

    private UserPrincipal principal;
    private UUID userId;

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
    }

    @Test
    void searchWrapsHitsInTheApiEnvelope() throws Exception {
        UUID documentId = UUID.randomUUID();
        SearchHitResponse hit = new SearchHitResponse(
                documentId,
                List.of(new SearchTextSegmentResponse("Auth", false)),
                List.of(new SearchTextSegmentResponse("body", false)),
                List.of(),
                null,
                null,
                OffsetDateTime.now());
        when(searchService.search(userId, "auth", null, null))
                .thenReturn(new SearchResponse("auth", List.of(hit), false, 0));

        mockMvc.perform(get("/api/v1/search").param("q", "auth").with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.query").value("auth"))
                .andExpect(jsonPath("$.data.items[0].documentId").value(documentId.toString()));
    }

    @Test
    void searchRequiresAQueryParameter() throws Exception {
        mockMvc.perform(get("/api/v1/search").with(user(principal))).andExpect(status().isBadRequest());
    }

    @Test
    void searchRequiresAuthentication() throws Exception {
        mockMvc.perform(get("/api/v1/search").param("q", "auth")).andExpect(status().isUnauthorized());
    }

    @Test
    void validationFailuresUseTheUniformErrorShape() throws Exception {
        when(searchService.search(userId, "a", null, null))
                .thenThrow(
                        new ApiException(ErrorCode.VALIDATION_FAILED, "Query must be between 1 and 200 characters."));

        mockMvc.perform(get("/api/v1/search").param("q", "a").with(user(principal)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value(ErrorCode.VALIDATION_FAILED.defaultMessage()))
                .andExpect(jsonPath("$.message").value("Query must be between 1 and 200 characters."));
    }

    @Test
    void suggestReturnsTitleHits() throws Exception {
        UUID documentId = UUID.randomUUID();
        when(searchService.suggest(userId, "auth", 5))
                .thenReturn(List.of(new SearchHitResponse(
                        documentId,
                        List.of(new SearchTextSegmentResponse("Auth", false)),
                        List.of(),
                        List.of(),
                        null,
                        null,
                        OffsetDateTime.now())));

        mockMvc.perform(get("/api/v1/search/suggest")
                        .param("q", "auth")
                        .param("limit", "5")
                        .with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].documentId").value(documentId.toString()));
    }
}
