package com.nextdocs.api.document.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.auth.security.JwtTokenProvider;
import com.nextdocs.api.auth.security.UserPrincipal;
import com.nextdocs.api.document.dto.response.CollaboratorResponse;
import com.nextdocs.api.document.dto.response.DocumentAccessResponse;
import com.nextdocs.api.document.dto.response.DocumentResponse;
import com.nextdocs.api.document.dto.response.SharingSettingsResponse;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.entity.DocumentGeneralAccessMode;
import com.nextdocs.api.document.service.DocumentSharingService;
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

@WebMvcTest(DocumentSharingController.class)
@Import({
    com.nextdocs.api.auth.security.SecurityConfig.class,
    com.nextdocs.api.common.cache.CaffeineCacheStore.class,
    com.nextdocs.api.auth.security.ratelimit.InMemoryRateLimiter.class
})
class DocumentSharingControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private DocumentSharingService sharingService;

    @MockitoBean
    private JwtTokenProvider jwtTokenProvider;

    @MockitoBean
    private UserRepository userRepository;

    private UserPrincipal principal;
    private UUID userId;
    private UUID documentId;
    private UUID collaboratorUserId;

    @BeforeEach
    void setUp() {
        User user = User.builder()
                .email("owner@example.com")
                .displayName("Owner")
                .passwordHash("$2a$12$hash")
                .build();
        userId = UUID.randomUUID();
        user.setId(userId);
        principal = UserPrincipal.from(user);
        documentId = UUID.randomUUID();
        collaboratorUserId = UUID.randomUUID();
    }

    @Test
    void listCollaborators_success_returns200() throws Exception {
        List<CollaboratorResponse> response = List.of(new CollaboratorResponse(
                userId, "owner@example.com", "Owner", DocumentAccessLevel.OWNER, OffsetDateTime.now()));

        when(sharingService.listCollaborators(userId, documentId)).thenReturn(response);

        mockMvc.perform(get("/api/v1/documents/{id}/collaborators", documentId).with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data[0].accessLevel").value("OWNER"));
    }

    @Test
    void upsertCollaborator_success_returns201() throws Exception {
        CollaboratorResponse response = new CollaboratorResponse(
                collaboratorUserId, "alice@example.com", "Alice", DocumentAccessLevel.EDIT, OffsetDateTime.now());

        when(sharingService.upsertCollaborator(eq(userId), eq(documentId), any()))
                .thenReturn(response);

        mockMvc.perform(post("/api/v1/documents/{id}/collaborators", documentId)
                        .with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                        {
                          "email": "alice@example.com",
                          "accessLevel": "EDIT"
                        }
                        """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.email").value("alice@example.com"));
    }

    @Test
    void updateCollaboratorAccess_success_returns200() throws Exception {
        CollaboratorResponse response = new CollaboratorResponse(
                collaboratorUserId, "alice@example.com", "Alice", DocumentAccessLevel.VIEW, OffsetDateTime.now());

        when(sharingService.updateCollaboratorAccess(eq(userId), eq(documentId), eq(collaboratorUserId), any()))
                .thenReturn(response);

        mockMvc.perform(patch(
                                "/api/v1/documents/{id}/collaborators/{collaboratorUserId}",
                                documentId,
                                collaboratorUserId)
                        .with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                        {
                          "accessLevel": "VIEW"
                        }
                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.accessLevel").value("VIEW"));
    }

    @Test
    void removeCollaborator_success_returns204() throws Exception {
        doNothing().when(sharingService).removeCollaborator(userId, documentId, collaboratorUserId);

        mockMvc.perform(delete(
                                "/api/v1/documents/{id}/collaborators/{collaboratorUserId}",
                                documentId,
                                collaboratorUserId)
                        .with(user(principal)))
                .andExpect(status().isNoContent());
    }

    @Test
    void leaveSharedDocument_success_returns204() throws Exception {
        doNothing().when(sharingService).leaveSharedDocument(userId, documentId);

        mockMvc.perform(delete("/api/v1/documents/{id}/collaborators/me", documentId)
                        .with(user(principal)))
                .andExpect(status().isNoContent());
    }

    @Test
    void getSharingSettings_success_returns200() throws Exception {
        SharingSettingsResponse response =
                new SharingSettingsResponse(DocumentGeneralAccessMode.RESTRICTED, DocumentAccessLevel.VIEW, false);

        when(sharingService.getSharingSettings(userId, documentId)).thenReturn(response);

        mockMvc.perform(get("/api/v1/documents/{id}/sharing", documentId).with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.generalAccessMode").value("RESTRICTED"));
    }

    @Test
    void updateSharingSettings_success_returns200() throws Exception {
        SharingSettingsResponse response =
                new SharingSettingsResponse(DocumentGeneralAccessMode.ANYONE_WITH_LINK, DocumentAccessLevel.EDIT, true);

        when(sharingService.updateSharingSettings(eq(userId), eq(documentId), any()))
                .thenReturn(response);

        mockMvc.perform(patch("/api/v1/documents/{id}/sharing", documentId)
                        .with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                        {
                          "generalAccessMode": "ANYONE_WITH_LINK",
                          "linkAccessLevel": "EDIT"
                        }
                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.linkAccessLevel").value("EDIT"));
    }

    @Test
    void updateSharingSettings_anyoneWithLink_withoutLinkAccessLevel_returns400() throws Exception {
        mockMvc.perform(patch("/api/v1/documents/{id}/sharing", documentId)
                        .with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                                                                                {
                                                                                                        "generalAccessMode": "ANYONE_WITH_LINK"
                                                                                                }
                                                                                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message")
                        .value(org.hamcrest.Matchers.containsString(
                                "linkAccessLevel is required when generalAccessMode is ANYONE_WITH_LINK.")));

        verifyNoInteractions(sharingService);
    }

    @Test
    void updateSharingSettings_restricted_withLinkAccessLevel_returns400() throws Exception {
        mockMvc.perform(patch("/api/v1/documents/{id}/sharing", documentId)
                        .with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                                                                                {
                                                                                                        "generalAccessMode": "RESTRICTED",
                                                                                                        "linkAccessLevel": "VIEW"
                                                                                                }
                                                                                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message")
                        .value(org.hamcrest.Matchers.containsString(
                                "linkAccessLevel must be omitted unless generalAccessMode is ANYONE_WITH_LINK.")));

        verifyNoInteractions(sharingService);
    }

    @Test
    void listSharedWithMe_success_returns200() throws Exception {
        DocumentResponse doc = new DocumentResponse(
                documentId, "Shared Doc", null, "Owner", OffsetDateTime.now(), OffsetDateTime.now(), null, null);

        Page<DocumentResponse> page = new PageImpl<>(List.of(doc), PageRequest.of(0, 20), 1);
        when(sharingService.listSharedWithMe(eq(userId), any())).thenReturn(page);

        mockMvc.perform(get("/api/v1/documents/shared-with-me").with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.content[0].id").value(documentId.toString()));
    }

    @Test
    void accessCheck_success_returns200() throws Exception {
        DocumentAccessResponse response = new DocumentAccessResponse(documentId, true, DocumentAccessLevel.EDIT, false);

        when(sharingService.accessCheck(userId, documentId)).thenReturn(response);

        mockMvc.perform(get("/api/v1/documents/{id}/access-check", documentId).with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.allowed").value(true))
                .andExpect(jsonPath("$.data.accessLevel").value("EDIT"));
    }

    @Test
    void endpoints_withoutAuthentication_return401() throws Exception {
        mockMvc.perform(get("/api/v1/documents/{id}/collaborators", documentId)).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/documents/{id}/sharing", documentId)).andExpect(status().isUnauthorized());
    }
}
