package com.nextdocs.api.document.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.auth.security.JwtTokenProvider;
import com.nextdocs.api.auth.security.UserPrincipal;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.dto.response.DocumentResponse;
import com.nextdocs.api.document.service.DocumentService;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(DocumentController.class)
@Import({
    com.nextdocs.api.auth.security.SecurityConfig.class,
    com.nextdocs.api.common.cache.CaffeineCacheStore.class,
    com.nextdocs.api.auth.security.ratelimit.InMemoryRateLimiter.class
})
class DocumentControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private DocumentService documentService;

    @MockitoBean
    private JwtTokenProvider jwtTokenProvider;

    @MockitoBean
    private UserRepository userRepository;

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
    void create_success_returns201() throws Exception {
        DocumentResponse response = new DocumentResponse(
                documentId, "My Doc", "AQID", "Alice", OffsetDateTime.now(), OffsetDateTime.now(), null, null);

        when(documentService.create(eq(userId), any()))
                .thenReturn(new DocumentService.CreateDocumentResult(response, true));

        mockMvc.perform(post("/api/v1/documents")
                        .with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                        {
                          "title": "My Doc",
                          "yjsState": "AQID"
                        }
                        """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.id").value(documentId.toString()))
                .andExpect(jsonPath("$.message").value("Document created."));
    }

    @Test
    void create_existingClientDocument_returns200() throws Exception {
        DocumentResponse response = new DocumentResponse(
                documentId, "My Doc", "AQID", "Alice", OffsetDateTime.now(), OffsetDateTime.now(), null, null);

        when(documentService.create(eq(userId), any()))
                .thenReturn(new DocumentService.CreateDocumentResult(response, false));

        mockMvc.perform(post("/api/v1/documents")
                        .with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                        {
                          "id": "%s",
                          "title": "My Doc",
                          "yjsState": "AQID"
                        }
                        """.formatted(documentId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.id").value(documentId.toString()))
                .andExpect(jsonPath("$.message").value("Document already exists."));
    }

    @Test
    void list_success_returns200() throws Exception {
        DocumentResponse response = new DocumentResponse(
                documentId, "My Doc", null, "Alice", OffsetDateTime.now(), OffsetDateTime.now(), null, null);

        Page<DocumentResponse> page = new PageImpl<>(List.of(response), PageRequest.of(0, 20), 1);
        when(documentService.list(eq(userId), any(), eq(false))).thenReturn(page);

        mockMvc.perform(get("/api/v1/documents").with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.content[0].id").value(documentId.toString()));
    }

    @Test
    void get_notFound_returns404() throws Exception {
        when(documentService.get(eq(userId), eq(documentId), eq(false)))
                .thenThrow(new ApiException(ErrorCode.NOT_FOUND));

        mockMvc.perform(get("/api/v1/documents/{id}", documentId).with(user(principal)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    void update_success_returns200() throws Exception {
        DocumentResponse response = new DocumentResponse(
                documentId, "Updated", "AQID", "Alice", OffsetDateTime.now(), OffsetDateTime.now(), null, null);

        when(documentService.update(eq(userId), eq(documentId), any())).thenReturn(response);

        mockMvc.perform(patch("/api/v1/documents/{id}", documentId)
                        .with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                        {
                          "title": "Updated"
                        }
                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.title").value("Updated"));
    }

    @Test
    void delete_success_returns204() throws Exception {
        doNothing().when(documentService).delete(userId, documentId, false);

        mockMvc.perform(delete("/api/v1/documents/{id}", documentId).with(user(principal)))
                .andExpect(status().isNoContent());
    }

    @Test
    void list_trashed_success_returns200() throws Exception {
        OffsetDateTime deleted = OffsetDateTime.parse("2025-01-01T00:00:00Z");
        DocumentResponse response = new DocumentResponse(
                documentId,
                "Trashed",
                null,
                "Alice",
                OffsetDateTime.now(),
                OffsetDateTime.now(),
                deleted,
                deleted.plusDays(30));

        Page<DocumentResponse> page = new PageImpl<>(List.of(response), PageRequest.of(0, 20), 1);
        when(documentService.list(eq(userId), any(), eq(true))).thenReturn(page);

        mockMvc.perform(get("/api/v1/documents").param("trashed", "true").with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.content[0].deletedAt").exists());
    }

    @Test
    void restore_success_returns200() throws Exception {
        DocumentResponse response = new DocumentResponse(
                documentId, "Restored", null, "Alice", OffsetDateTime.now(), OffsetDateTime.now(), null, null);

        when(documentService.restore(eq(userId), eq(documentId))).thenReturn(response);

        mockMvc.perform(post("/api/v1/documents/{id}/restore", documentId).with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.title").value("Restored"));
    }

    @Test
    void endpoints_withoutAuthentication_return401() throws Exception {
        mockMvc.perform(get("/api/v1/documents")).andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/v1/documents")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                        {
                          "title": "My Doc",
                          "yjsState": "AQID"
                        }
                        """))
                .andExpect(status().isUnauthorized());
    }
}
