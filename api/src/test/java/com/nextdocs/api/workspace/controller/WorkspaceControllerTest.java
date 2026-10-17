package com.nextdocs.api.workspace.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.nextdocs.api.attachment.dto.response.AttachmentResponse;
import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.auth.security.JwtTokenProvider;
import com.nextdocs.api.auth.security.UserPrincipal;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.pageicon.dto.response.PageIconResponse;
import com.nextdocs.api.workspace.dto.request.WorkspaceUpdateRequest;
import com.nextdocs.api.workspace.dto.response.WorkspaceMemberResponse;
import com.nextdocs.api.workspace.dto.response.WorkspaceResponse;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import com.nextdocs.api.workspace.service.WorkspaceService;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.AbstractMockHttpServletRequestBuilder;

@WebMvcTest(WorkspaceController.class)
@Import({
    com.nextdocs.api.auth.security.SecurityConfig.class,
    com.nextdocs.api.common.cache.CaffeineCacheStore.class,
    com.nextdocs.api.auth.security.ratelimit.InMemoryRateLimiter.class
})
class WorkspaceControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private WorkspaceService workspaceService;

    @MockitoBean
    private JwtTokenProvider jwtTokenProvider;

    @MockitoBean
    private UserRepository userRepository;

    private UserPrincipal principal;
    private UUID userId;
    private UUID targetId;

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
        targetId = UUID.randomUUID();
    }

    @Test
    void getCurrent_success_returnsIdentityAndRole() throws Exception {
        WorkspaceResponse response = new WorkspaceResponse(
                UUID.randomUUID(), "Acme", new PageIconResponse("builtin", "home", "blue"), WorkspaceRole.OWNER, 3);
        when(workspaceService.getCurrent(userId)).thenReturn(response);

        mockMvc.perform(get(WorkspaceController.CURRENT_PATH).with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.name").value("Acme"))
                .andExpect(jsonPath("$.data.role").value("OWNER"))
                .andExpect(jsonPath("$.data.icon.type").value("builtin"))
                .andExpect(jsonPath("$.data.memberCount").value(3));
    }

    @Test
    void getCurrent_withoutAuthentication_returns401() throws Exception {
        mockMvc.perform(get(WorkspaceController.CURRENT_PATH)).andExpect(status().isUnauthorized());
    }

    @Test
    void updateCurrent_passesTheParsedRequestThrough() throws Exception {
        WorkspaceResponse response = new WorkspaceResponse(UUID.randomUUID(), "Acme", null, WorkspaceRole.OWNER, 2);
        when(workspaceService.updateCurrent(eq(userId), any(WorkspaceUpdateRequest.class)))
                .thenReturn(response);

        mockMvc.perform(patch(WorkspaceController.CURRENT_PATH)
                        .with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                        {
                          "name": "Acme",
                          "icon": {"type": "emoji", "value": "📝"}
                        }
                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.name").value("Acme"));
    }

    @Test
    void updateCurrent_rejectsAnOversizedName() throws Exception {
        mockMvc.perform(patch(WorkspaceController.CURRENT_PATH)
                        .with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\": \"" + "a".repeat(256) + "\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    void updateCurrent_rejectsControlCharactersInName() throws Exception {
        // A CR/LF in the name would be interpolated into invitation email subjects.
        mockMvc.perform(patch(WorkspaceController.CURRENT_PATH)
                        .with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\": \"Acme\\r\\nBcc: attacker@example.com\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    void listMembers_success_returnsRoster() throws Exception {
        WorkspaceMemberResponse member = new WorkspaceMemberResponse(
                targetId, "member@example.com", "Member", null, WorkspaceRole.ADMIN, OffsetDateTime.now());
        when(workspaceService.listMembers(userId)).thenReturn(List.of(member));

        mockMvc.perform(get(WorkspaceController.MEMBERS_PATH).with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].userId").value(targetId.toString()))
                .andExpect(jsonPath("$.data[0].role").value("ADMIN"))
                .andExpect(jsonPath("$.data[0].joinedAt").exists());
    }

    @Test
    void updateMemberRole_requiresARoleValue() throws Exception {
        mockMvc.perform(patch(WorkspaceController.MEMBERS_PATH + "/{userId}", targetId)
                        .with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"role\": \"\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void removeMember_success_returnsRecalculatedRoster() throws Exception {
        when(workspaceService.removeMember(userId, targetId)).thenReturn(List.of());

        mockMvc.perform(delete(WorkspaceController.MEMBERS_PATH + "/{userId}", targetId)
                        .with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true));
    }

    @Test
    void uploadAttachment_success_returns201() throws Exception {
        UUID attachmentId = UUID.randomUUID();
        when(workspaceService.uploadAttachment(eq(userId), any()))
                .thenReturn(new AttachmentResponse(
                        attachmentId,
                        null,
                        "icon.png",
                        "image/png",
                        3,
                        "/api/v1/attachments/" + attachmentId,
                        OffsetDateTime.now()));

        mockMvc.perform(declaredUpload(multipart(WorkspaceController.ATTACHMENTS_PATH)
                                .file(new MockMultipartFile("file", "icon.png", "image/png", new byte[] {1, 2, 3})))
                        .with(user(principal)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.url").value("/api/v1/attachments/" + attachmentId))
                .andExpect(jsonPath("$.data.documentId").doesNotExist())
                .andExpect(jsonPath("$.message").value("Attachment uploaded."));
    }

    @Test
    void uploadAttachment_withoutAuthentication_returns401() throws Exception {
        mockMvc.perform(declaredUpload(multipart(WorkspaceController.ATTACHMENTS_PATH)
                        .file(new MockMultipartFile("file", "icon.png", "image/png", new byte[] {1}))))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void uploadAttachment_nonOwner_returns403() throws Exception {
        when(workspaceService.uploadAttachment(eq(userId), any())).thenThrow(new ApiException(ErrorCode.FORBIDDEN));

        mockMvc.perform(declaredUpload(multipart(WorkspaceController.ATTACHMENTS_PATH)
                                .file(new MockMultipartFile("file", "icon.png", "image/png", new byte[] {1})))
                        .with(user(principal)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    void uploadAttachment_withoutFilePart_returns400() throws Exception {
        mockMvc.perform(declaredUpload(multipart(WorkspaceController.ATTACHMENTS_PATH))
                        .with(user(principal)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false));
    }

    /**
     * MockMvc multipart probes carry no body, so getContentLengthLong() reports -1 and the
     * rate-limit filter (rightly) refuses an undeclared multipart upload. Give the probe an
     * empty declared body so it exercises the controller, not the transport guard.
     */
    private static <T extends AbstractMockHttpServletRequestBuilder<T>> T declaredUpload(T builder) {
        return builder.with(request -> {
            request.setContent(new byte[0]);
            return request;
        });
    }
}
