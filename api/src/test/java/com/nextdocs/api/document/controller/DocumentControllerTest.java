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
import com.nextdocs.api.document.dto.request.DocumentMoveRequest;
import com.nextdocs.api.document.dto.response.DocumentBreadcrumbResponse;
import com.nextdocs.api.document.dto.response.DocumentResponse;
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
    private DocumentTreeService documentTreeService;

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
                documentId,
                "My Doc",
                "AQID",
                null,
                null,
                false,
                false,
                DocumentAccessLevel.OWNER,
                "Alice",
                OffsetDateTime.now(),
                OffsetDateTime.now(),
                null,
                null);

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
                documentId,
                "My Doc",
                "AQID",
                null,
                null,
                false,
                false,
                DocumentAccessLevel.OWNER,
                "Alice",
                OffsetDateTime.now(),
                OffsetDateTime.now(),
                null,
                null);

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
    void list_default_success_returns200() throws Exception {
        DocumentResponse response = new DocumentResponse(
                documentId,
                "My Doc",
                null,
                null,
                "a0",
                false,
                false,
                DocumentAccessLevel.OWNER,
                "Alice",
                OffsetDateTime.now(),
                OffsetDateTime.now(),
                null,
                null);

        Page<DocumentResponse> page = new PageImpl<>(List.of(response), PageRequest.of(0, 20), 1);
        when(documentService.list(eq(userId), eq(null), eq("all"), eq(null), any()))
                .thenReturn(page);

        mockMvc.perform(get("/api/v1/documents").with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.content[0].id").value(documentId.toString()))
                .andExpect(jsonPath("$.data.content[0].hasChildren").value(false))
                .andExpect(jsonPath("$.data.content[0].accessLevel").value("OWNER"));
    }

    @Test
    void list_rootPrivate_success_returns200() throws Exception {
        DocumentResponse response = new DocumentResponse(
                documentId,
                "Root Private",
                null,
                null,
                "a0",
                true,
                false,
                DocumentAccessLevel.OWNER,
                "Alice",
                OffsetDateTime.now(),
                OffsetDateTime.now(),
                null,
                null);

        Page<DocumentResponse> page = new PageImpl<>(List.of(response), PageRequest.of(0, 50), 1);
        when(documentService.list(eq(userId), eq("root"), eq("private"), eq(null), any()))
                .thenReturn(page);

        mockMvc.perform(get("/api/v1/documents")
                        .param("parentId", "root")
                        .param("scope", "private")
                        .with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.content[0].id").value(documentId.toString()))
                .andExpect(jsonPath("$.data.content[0].hasChildren").value(true))
                .andExpect(jsonPath("$.data.content[0].hasCollaborators").value(false));
    }

    @Test
    void list_rootShared_success_returns200() throws Exception {
        DocumentResponse response = new DocumentResponse(
                documentId,
                "Root Shared",
                null,
                null,
                "a0",
                false,
                true,
                DocumentAccessLevel.EDIT,
                "Bob",
                OffsetDateTime.now(),
                OffsetDateTime.now(),
                null,
                null);

        Page<DocumentResponse> page = new PageImpl<>(List.of(response), PageRequest.of(0, 50), 1);
        when(documentService.list(eq(userId), eq("root"), eq("shared"), eq(null), any()))
                .thenReturn(page);

        mockMvc.perform(get("/api/v1/documents")
                        .param("parentId", "root")
                        .param("scope", "shared")
                        .with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.content[0].id").value(documentId.toString()))
                .andExpect(jsonPath("$.data.content[0].hasCollaborators").value(true))
                .andExpect(jsonPath("$.data.content[0].accessLevel").value("EDIT"));
    }

    @Test
    void list_children_success_returns200() throws Exception {
        UUID parentId = UUID.randomUUID();
        DocumentResponse response = new DocumentResponse(
                documentId,
                "Child Doc",
                null,
                parentId,
                "a0",
                false,
                false,
                DocumentAccessLevel.OWNER,
                "Alice",
                OffsetDateTime.now(),
                OffsetDateTime.now(),
                null,
                null);

        Page<DocumentResponse> page = new PageImpl<>(List.of(response), PageRequest.of(0, 50), 1);
        when(documentService.list(eq(userId), eq(parentId.toString()), eq("all"), eq(null), any()))
                .thenReturn(page);

        mockMvc.perform(get("/api/v1/documents")
                        .param("parentId", parentId.toString())
                        .with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.content[0].parentId").value(parentId.toString()));
    }

    @Test
    void list_trashed_success_returns200() throws Exception {
        OffsetDateTime deleted = OffsetDateTime.parse("2025-01-01T00:00:00Z");
        DocumentResponse response = new DocumentResponse(
                documentId,
                "Trashed",
                null,
                null,
                null,
                false,
                false,
                DocumentAccessLevel.OWNER,
                "Alice",
                OffsetDateTime.now(),
                OffsetDateTime.now(),
                deleted,
                deleted.plusDays(30));

        Page<DocumentResponse> page = new PageImpl<>(List.of(response), PageRequest.of(0, 20), 1);
        when(documentService.list(eq(userId), eq(null), eq("all"), eq(true), any()))
                .thenReturn(page);

        mockMvc.perform(get("/api/v1/documents").param("trashed", "true").with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.content[0].deletedAt").exists());
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
                documentId,
                "Updated",
                "AQID",
                null,
                null,
                false,
                false,
                DocumentAccessLevel.OWNER,
                "Alice",
                OffsetDateTime.now(),
                OffsetDateTime.now(),
                null,
                null);

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
    void restore_success_returns200() throws Exception {
        DocumentResponse response = new DocumentResponse(
                documentId,
                "Restored",
                null,
                null,
                null,
                false,
                false,
                DocumentAccessLevel.OWNER,
                "Alice",
                OffsetDateTime.now(),
                OffsetDateTime.now(),
                null,
                null);

        when(documentService.restore(eq(userId), eq(documentId))).thenReturn(response);

        mockMvc.perform(post("/api/v1/documents/{id}/restore", documentId).with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.title").value("Restored"));
    }

    @Test
    void move_success_returns200() throws Exception {
        DocumentResponse moved = new DocumentResponse(
                documentId,
                "Moved",
                null,
                null,
                "a1",
                false,
                false,
                DocumentAccessLevel.OWNER,
                "Alice",
                OffsetDateTime.now(),
                OffsetDateTime.now(),
                null,
                null);

        when(documentTreeService.move(eq(userId), eq(documentId), any(DocumentMoveRequest.class)))
                .thenReturn(moved);

        mockMvc.perform(post("/api/v1/documents/{id}/move", documentId)
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
                .andExpect(jsonPath("$.data.id").value(documentId.toString()))
                .andExpect(jsonPath("$.data.orderKey").value("a1"));
    }

    @Test
    void getBreadcrumbs_success_returns200() throws Exception {
        UUID rootId = UUID.randomUUID();
        DocumentBreadcrumbResponse root = new DocumentBreadcrumbResponse(rootId, "Root Page", null, null);
        DocumentBreadcrumbResponse child = new DocumentBreadcrumbResponse(documentId, "Child Page", null, rootId);

        when(documentService.getBreadcrumbs(eq(userId), eq(documentId))).thenReturn(List.of(root, child));

        mockMvc.perform(get("/api/v1/documents/{id}/path", documentId).with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data[0].id").value(rootId.toString()))
                .andExpect(jsonPath("$.data[0].title").value("Root Page"))
                .andExpect(jsonPath("$.data[1].id").value(documentId.toString()))
                .andExpect(jsonPath("$.data[1].title").value("Child Page"));
    }

    @Test
    void getPublicBreadcrumbs_success_returns200() throws Exception {
        DocumentBreadcrumbResponse item = new DocumentBreadcrumbResponse(documentId, "Public Doc", null, null);

        when(documentService.getPublicBreadcrumbs(eq(documentId))).thenReturn(List.of(item));

        mockMvc.perform(get("/api/v1/documents/{id}/public/path", documentId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data[0].id").value(documentId.toString()))
                .andExpect(jsonPath("$.data[0].title").value("Public Doc"));
    }

    @Test
    void retiredTreeEndpoints_return404() throws Exception {
        mockMvc.perform(get("/api/v1/documents/tree/root").with(user(principal)))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/v1/documents/tree/shared").with(user(principal)))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/v1/documents/{id}/children", UUID.randomUUID())
                        .with(user(principal)))
                .andExpect(status().isNotFound());
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
