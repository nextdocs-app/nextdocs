package com.nextdocs.api.space.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
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
import com.nextdocs.api.document.dto.response.DocumentResponse;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.pageicon.dto.response.PageIconResponse;
import com.nextdocs.api.space.dto.request.SpaceCreateRequest;
import com.nextdocs.api.space.dto.request.SpaceMemberAccessUpdateRequest;
import com.nextdocs.api.space.dto.request.SpaceMemberCreateRequest;
import com.nextdocs.api.space.dto.request.SpaceMoveRequest;
import com.nextdocs.api.space.dto.request.SpaceUpdateRequest;
import com.nextdocs.api.space.dto.response.SpaceMemberResponse;
import com.nextdocs.api.space.dto.response.SpaceResponse;
import com.nextdocs.api.space.entity.SpaceAccessMode;
import com.nextdocs.api.space.service.SpaceService;
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

@WebMvcTest(SpaceController.class)
@Import({
    com.nextdocs.api.auth.security.SecurityConfig.class,
    com.nextdocs.api.common.cache.CaffeineCacheStore.class,
    com.nextdocs.api.auth.security.ratelimit.InMemoryRateLimiter.class
})
class SpaceControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private SpaceService spaceService;

    @MockitoBean
    private JwtTokenProvider jwtTokenProvider;

    @MockitoBean
    private WorkspaceMemberRepository memberRepository;

    private UserPrincipal principal;
    private UUID userId;
    private UUID spaceId;

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
        spaceId = UUID.randomUUID();
    }

    private SpaceResponse response() {
        return new SpaceResponse(
                spaceId,
                "Engineering",
                "a1",
                new PageIconResponse("emoji", "🚀"),
                SpaceAccessMode.PUBLIC,
                DocumentAccessLevel.VIEW,
                DocumentAccessLevel.OWNER,
                true,
                3,
                5,
                null,
                OffsetDateTime.now(),
                OffsetDateTime.now());
    }

    @Test
    void list_returnsSpaces() throws Exception {
        when(spaceService.listSpaces(userId, false)).thenReturn(List.of(response()));

        mockMvc.perform(get(SpaceController.BASE_PATH).with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].name").value("Engineering"))
                .andExpect(jsonPath("$.data[0].accessMode").value("PUBLIC"))
                .andExpect(jsonPath("$.data[0].myAccessLevel").value("OWNER"))
                .andExpect(jsonPath("$.data[0].pageCount").value(5));
    }

    @Test
    void list_archived_returnsTheRestoreView() throws Exception {
        when(spaceService.listSpaces(userId, true)).thenReturn(List.of(response()));

        mockMvc.perform(get(SpaceController.BASE_PATH).param("archived", "true").with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].name").value("Engineering"));

        verify(spaceService).listSpaces(userId, true);
    }

    @Test
    void list_withoutAuthentication_returns401() throws Exception {
        mockMvc.perform(get(SpaceController.BASE_PATH)).andExpect(status().isUnauthorized());
    }

    @Test
    void create_returns201WithTheCreatedSpace() throws Exception {
        when(spaceService.createSpace(eq(userId), any(SpaceCreateRequest.class)))
                .thenReturn(response());

        mockMvc.perform(post(SpaceController.BASE_PATH)
                        .with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                        {
                          "name": "Engineering",
                          "accessMode": "PUBLIC",
                          "everyoneAccessLevel": "VIEW"
                        }
                        """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.name").value("Engineering"));
    }

    @Test
    void create_withBlankName_returns400() throws Exception {
        mockMvc.perform(post(SpaceController.BASE_PATH)
                        .with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\": \"  \"}"))
                .andExpect(status().isBadRequest());

        verify(spaceService, never()).createSpace(any(), any());
    }

    @Test
    void get_returnsOneSpace() throws Exception {
        when(spaceService.getSpace(userId, spaceId)).thenReturn(response());

        mockMvc.perform(get(SpaceController.BASE_PATH + "/{id}", spaceId).with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(spaceId.toString()));
    }

    @Test
    void move_passesTheNeighboursAndReturnsTheUpdatedSpace() throws Exception {
        UUID prevId = UUID.randomUUID();
        when(spaceService.moveSpace(eq(userId), eq(spaceId), any(SpaceMoveRequest.class)))
                .thenReturn(response());

        mockMvc.perform(post(SpaceController.MOVE_PATH, spaceId)
                        .with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"prevSiblingId\": \"" + prevId + "\", \"nextSiblingId\": null}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.orderKey").value("a1"));

        verify(spaceService).moveSpace(eq(userId), eq(spaceId), any(SpaceMoveRequest.class));
    }

    @Test
    void update_passesThePatchThrough() throws Exception {
        when(spaceService.updateSpace(eq(userId), eq(spaceId), any(SpaceUpdateRequest.class)))
                .thenReturn(response());

        mockMvc.perform(patch(SpaceController.BASE_PATH + "/{id}", spaceId)
                        .with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\": \"Engineering\", \"accessMode\": \"PUBLIC\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.accessMode").value("PUBLIC"));
    }

    @Test
    void archive_returnsTheArchivedSpace() throws Exception {
        when(spaceService.archiveSpace(userId, spaceId)).thenReturn(response());

        mockMvc.perform(post(SpaceController.BASE_PATH + "/{id}/archive", spaceId)
                        .with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.name").value("Engineering"));

        verify(spaceService).archiveSpace(userId, spaceId);
    }

    @Test
    void restore_returnsTheRestoredSpace() throws Exception {
        when(spaceService.restoreSpace(userId, spaceId)).thenReturn(response());

        mockMvc.perform(post(SpaceController.BASE_PATH + "/{id}/restore", spaceId)
                        .with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.name").value("Engineering"));

        verify(spaceService).restoreSpace(userId, spaceId);
    }

    @Test
    void delete_deletesOnlyTheEmptySpace() throws Exception {
        mockMvc.perform(delete(SpaceController.BASE_PATH + "/{id}", spaceId).with(user(principal)))
                .andExpect(status().isNoContent());

        verify(spaceService).deleteSpace(userId, spaceId);
    }

    @Test
    void listMembers_returnsTheRoster() throws Exception {
        when(spaceService.listMembers(userId, spaceId))
                .thenReturn(List.of(new SpaceMemberResponse(
                        UUID.randomUUID(),
                        "bob@example.com",
                        "Bob",
                        null,
                        DocumentAccessLevel.EDIT,
                        OffsetDateTime.now())));

        mockMvc.perform(get(SpaceController.MEMBERS_PATH, spaceId).with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].email").value("bob@example.com"))
                .andExpect(jsonPath("$.data[0].accessLevel").value("EDIT"));
    }

    @Test
    void addMember_returns201WithTheRecalculatedRoster() throws Exception {
        when(spaceService.addMember(eq(userId), eq(spaceId), any(SpaceMemberCreateRequest.class)))
                .thenReturn(List.of());

        mockMvc.perform(post(SpaceController.MEMBERS_PATH, spaceId)
                        .with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\": \"bob@example.com\", \"accessLevel\": \"EDIT\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.success").value(true));
    }

    @Test
    void addMember_withoutAnAccessLevel_returns400() throws Exception {
        mockMvc.perform(post(SpaceController.MEMBERS_PATH, spaceId)
                        .with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\": \"bob@example.com\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void updateMemberAccess_returnsTheRoster() throws Exception {
        UUID memberId = UUID.randomUUID();
        when(spaceService.updateMemberAccess(
                        eq(userId), eq(spaceId), eq(memberId), any(SpaceMemberAccessUpdateRequest.class)))
                .thenReturn(List.of());

        mockMvc.perform(patch(SpaceController.MEMBERS_PATH + "/{userId}", spaceId, memberId)
                        .with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accessLevel\": \"OWNER\"}"))
                .andExpect(status().isOk());
    }

    @Test
    void removeMember_returnsTheRoster() throws Exception {
        UUID memberId = UUID.randomUUID();
        when(spaceService.removeMember(userId, spaceId, memberId)).thenReturn(List.of());

        mockMvc.perform(delete(SpaceController.MEMBERS_PATH + "/{userId}", spaceId, memberId)
                        .with(user(principal)))
                .andExpect(status().isOk());
    }

    @Test
    void attachPage_returnsThePageProjection() throws Exception {
        UUID documentId = UUID.randomUUID();
        DocumentResponse page = DocumentResponse.withoutBranding(
                documentId,
                "Root Page",
                null,
                null,
                null,
                false,
                false,
                DocumentAccessLevel.OWNER,
                "Owner",
                OffsetDateTime.now(),
                OffsetDateTime.now(),
                null,
                null,
                null,
                null);
        when(spaceService.attachPage(userId, spaceId, documentId)).thenReturn(page);

        mockMvc.perform(post(SpaceController.PAGES_PATH, spaceId)
                        .with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"documentId\": \"" + documentId + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.title").value("Root Page"));
    }

    @Test
    void attachPage_withoutADocumentId_returns400() throws Exception {
        mockMvc.perform(post(SpaceController.PAGES_PATH, spaceId)
                        .with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void detachPage_returns204() throws Exception {
        UUID documentId = UUID.randomUUID();

        mockMvc.perform(delete(SpaceController.PAGES_PATH + "/{documentId}", spaceId, documentId)
                        .with(user(principal)))
                .andExpect(status().isNoContent());

        verify(spaceService).detachPage(userId, spaceId, documentId);
    }
}
