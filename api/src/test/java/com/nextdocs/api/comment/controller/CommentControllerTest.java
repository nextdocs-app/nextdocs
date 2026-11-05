package com.nextdocs.api.comment.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.security.JwtTokenProvider;
import com.nextdocs.api.auth.security.UserPrincipal;
import com.nextdocs.api.comment.dto.response.CommentAbilitiesResponse;
import com.nextdocs.api.comment.dto.response.CommentAuthorResponse;
import com.nextdocs.api.comment.dto.response.CommentResponse;
import com.nextdocs.api.comment.dto.response.ThreadAbilitiesResponse;
import com.nextdocs.api.comment.dto.response.ThreadResponse;
import com.nextdocs.api.comment.service.CommentService;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(CommentController.class)
@Import({
    com.nextdocs.api.auth.security.SecurityConfig.class,
    com.nextdocs.api.common.cache.CaffeineCacheStore.class,
    com.nextdocs.api.auth.security.ratelimit.InMemoryRateLimiter.class
})
class CommentControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private CommentService commentService;

    @MockitoBean
    private JwtTokenProvider jwtTokenProvider;

    @MockitoBean
    private WorkspaceMemberRepository memberRepository;

    private UserPrincipal principal;
    private UUID userId;
    private UUID documentId;
    private UUID threadId;
    private UUID commentId;

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
        threadId = UUID.randomUUID();
        commentId = UUID.randomUUID();
    }

    @Test
    void list_asMember_returnsThreads() throws Exception {
        when(commentService.listThreads(userId, documentId)).thenReturn(List.of(thread()));

        mockMvc.perform(get("/api/v1/documents/{documentId}/threads", documentId)
                        .with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data[0].id").value(threadId.toString()))
                .andExpect(jsonPath("$.data[0].comments[0].abilities.update").value(true))
                .andExpect(jsonPath("$.data[0].abilities.delete").value(false));
    }

    @Test
    void list_anonymous_isAuthorizedByTheService() throws Exception {
        when(commentService.listThreads(isNull(), eq(documentId))).thenReturn(List.of());

        mockMvc.perform(get("/api/v1/documents/{documentId}/threads", documentId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true));
    }

    @Test
    void list_invalidBearerFailsClosed() throws Exception {
        mockMvc.perform(get("/api/v1/documents/{documentId}/threads", documentId)
                        .header("Authorization", "Bearer stale-token"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.success").value(false));

        verify(commentService, never()).listThreads(any(), any());
    }

    @Test
    void list_viewOnly_returnsForbidden() throws Exception {
        when(commentService.listThreads(userId, documentId)).thenThrow(new ApiException(ErrorCode.FORBIDDEN));

        mockMvc.perform(get("/api/v1/documents/{documentId}/threads", documentId)
                        .with(user(principal)))
                .andExpect(status().isForbidden());
    }

    @Test
    void create_returns201WithThread() throws Exception {
        when(commentService.createThread(eq(userId), eq(documentId), any())).thenReturn(thread());

        mockMvc.perform(post("/api/v1/documents/{documentId}/threads", documentId)
                        .with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"body\":[{\"type\":\"paragraph\"}]}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.id").value(threadId.toString()));
    }

    @Test
    void create_missingBody_returnsBadRequest() throws Exception {
        mockMvc.perform(post("/api/v1/documents/{documentId}/threads", documentId)
                        .with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest());

        verify(commentService, never()).createThread(any(), any(), any());
    }

    @Test
    void reply_returns201WithComment() throws Exception {
        when(commentService.addComment(eq(userId), eq(documentId), eq(threadId), any()))
                .thenReturn(comment());

        mockMvc.perform(post("/api/v1/documents/{documentId}/threads/{threadId}/comments", documentId, threadId)
                        .with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"body\":[{\"type\":\"paragraph\"}]}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.id").value(commentId.toString()));
    }

    @Test
    void update_returnsNoContent() throws Exception {
        doNothing().when(commentService).updateComment(eq(userId), eq(documentId), eq(threadId), eq(commentId), any());

        mockMvc.perform(patch(
                                "/api/v1/documents/{documentId}/threads/{threadId}/comments/{commentId}",
                                documentId,
                                threadId,
                                commentId)
                        .with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"body\":[{\"type\":\"paragraph\"}]}"))
                .andExpect(status().isNoContent());
    }

    @Test
    void deleteThread_returnsNoContent() throws Exception {
        doNothing().when(commentService).deleteThread(userId, documentId, threadId);

        mockMvc.perform(delete("/api/v1/documents/{documentId}/threads/{threadId}", documentId, threadId)
                        .with(user(principal)))
                .andExpect(status().isNoContent());
    }

    @Test
    void resolve_returnsNoContent() throws Exception {
        doNothing().when(commentService).resolveThread(userId, documentId, threadId);

        mockMvc.perform(post("/api/v1/documents/{documentId}/threads/{threadId}/resolve", documentId, threadId)
                        .with(user(principal)))
                .andExpect(status().isNoContent());
    }

    @Test
    void addReaction_returnsNoContent() throws Exception {
        doNothing().when(commentService).addReaction(userId, documentId, threadId, commentId, "👍");

        mockMvc.perform(post(
                                "/api/v1/documents/{documentId}/threads/{threadId}/comments/{commentId}/reactions",
                                documentId,
                                threadId,
                                commentId)
                        .with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"emoji\":\"👍\"}"))
                .andExpect(status().isNoContent());
    }

    @Test
    void deleteReaction_returnsNoContent() throws Exception {
        doNothing().when(commentService).removeReaction(userId, documentId, threadId, commentId, "👍");

        mockMvc.perform(delete(
                                "/api/v1/documents/{documentId}/threads/{threadId}/comments/{commentId}/reactions/{emoji}",
                                documentId,
                                threadId,
                                commentId,
                                "👍")
                        .with(user(principal)))
                .andExpect(status().isNoContent());
    }

    @Test
    void get_missingThread_returnsNotFound() throws Exception {
        when(commentService.getThread(userId, documentId, threadId)).thenThrow(new ApiException(ErrorCode.NOT_FOUND));

        mockMvc.perform(get("/api/v1/documents/{documentId}/threads/{threadId}", documentId, threadId)
                        .with(user(principal)))
                .andExpect(status().isNotFound());
    }

    private ThreadResponse thread() {
        CommentAuthorResponse author = new CommentAuthorResponse(userId, "Alice", null);
        CommentResponse comment = new CommentResponse(
                commentId,
                author,
                new tools.jackson.databind.ObjectMapper().readTree("[{\"type\":\"paragraph\"}]"),
                OffsetDateTime.now(),
                OffsetDateTime.now(),
                List.of(),
                new CommentAbilitiesResponse(true, true, true));
        return new ThreadResponse(
                threadId,
                OffsetDateTime.now(),
                OffsetDateTime.now(),
                false,
                null,
                null,
                List.of(comment),
                new ThreadAbilitiesResponse(false, true, true));
    }

    private CommentResponse comment() {
        return thread().comments().getFirst();
    }
}
