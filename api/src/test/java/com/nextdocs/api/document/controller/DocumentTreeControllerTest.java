package com.nextdocs.api.document.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.auth.security.JwtTokenProvider;
import com.nextdocs.api.auth.security.UserPrincipal;
import com.nextdocs.api.document.dto.request.DocumentMoveRequest;
import com.nextdocs.api.document.dto.response.DocumentTreeNodeResponse;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.service.DocumentService;
import com.nextdocs.api.document.service.DocumentTreeService;
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
import org.springframework.data.domain.Pageable;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(DocumentController.class)
@Import({
    com.nextdocs.api.auth.security.SecurityConfig.class,
    com.nextdocs.api.common.cache.CaffeineCacheStore.class,
    com.nextdocs.api.auth.security.ratelimit.InMemoryRateLimiter.class
})
class DocumentTreeControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private DocumentTreeService documentTreeService;

    @MockitoBean
    private DocumentService documentService;

    @MockitoBean
    private JwtTokenProvider jwtTokenProvider;

    @MockitoBean
    private UserRepository userRepository;

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
    void getRootDocuments_returns200() throws Exception {
        DocumentTreeNodeResponse node = new DocumentTreeNodeResponse(
                UUID.randomUUID(),
                "Root",
                null,
                "a0",
                false,
                DocumentAccessLevel.OWNER,
                OffsetDateTime.now(),
                OffsetDateTime.now());

        Page<DocumentTreeNodeResponse> page = new PageImpl<>(List.of(node));
        when(documentTreeService.getRootDocuments(eq(userId), any(Pageable.class)))
                .thenReturn(page);

        mockMvc.perform(get("/api/v1/documents/tree/root").with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.content[0].id").value(node.id().toString()))
                .andExpect(jsonPath("$.data.content[0].orderKey").value("a0"))
                .andExpect(jsonPath("$.data.content[0].hasChildren").value(false));
    }

    @Test
    void getSharedDocuments_returns200() throws Exception {
        DocumentTreeNodeResponse node = new DocumentTreeNodeResponse(
                UUID.randomUUID(),
                "Shared",
                null,
                "a0",
                false,
                DocumentAccessLevel.EDIT,
                OffsetDateTime.now(),
                OffsetDateTime.now());

        Page<DocumentTreeNodeResponse> page = new PageImpl<>(List.of(node));
        when(documentTreeService.getSharedDocuments(eq(userId), any(Pageable.class)))
                .thenReturn(page);

        mockMvc.perform(get("/api/v1/documents/tree/shared").with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.content[0].id").value(node.id().toString()))
                .andExpect(jsonPath("$.data.content[0].orderKey").value("a0"))
                .andExpect(jsonPath("$.data.content[0].hasChildren").value(false));
    }

    @Test
    void getChildren_returns200() throws Exception {
        UUID parentId = UUID.randomUUID();
        DocumentTreeNodeResponse child = new DocumentTreeNodeResponse(
                UUID.randomUUID(),
                "Child",
                parentId,
                "a0",
                true,
                DocumentAccessLevel.OWNER,
                OffsetDateTime.now(),
                OffsetDateTime.now());

        Page<DocumentTreeNodeResponse> page = new PageImpl<>(List.of(child));
        when(documentTreeService.getChildren(eq(userId), eq(parentId), any(Pageable.class)))
                .thenReturn(page);

        mockMvc.perform(get("/api/v1/documents/{id}/children", parentId).with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.content[0].parentId").value(parentId.toString()))
                .andExpect(jsonPath("$.data.content[0].hasChildren").value(true));
    }

    @Test
    void move_returns200() throws Exception {
        UUID docId = UUID.randomUUID();
        DocumentTreeNodeResponse moved = new DocumentTreeNodeResponse(
                docId,
                "Moved",
                null,
                "a1",
                false,
                DocumentAccessLevel.OWNER,
                OffsetDateTime.now(),
                OffsetDateTime.now());

        when(documentTreeService.move(eq(userId), eq(docId), any(DocumentMoveRequest.class)))
                .thenReturn(moved);

        mockMvc.perform(post("/api/v1/documents/{id}/move", docId)
                        .with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                        {
                          "newParentId": null,
                          "prevSiblingId": null,
                          "nextSiblingId": null
                        }
                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.id").value(docId.toString()));
    }

    @Test
    void endpoints_withoutAuthentication_return401() throws Exception {
        mockMvc.perform(get("/api/v1/documents/tree/root")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/documents/tree/shared")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/documents/{id}/children", UUID.randomUUID()))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/v1/documents/{id}/move", UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isUnauthorized());
    }
}
