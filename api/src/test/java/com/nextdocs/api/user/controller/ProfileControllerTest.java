package com.nextdocs.api.user.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.nextdocs.api.attachment.storage.StoredAttachment;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.security.JwtTokenProvider;
import com.nextdocs.api.security.UserPrincipal;
import com.nextdocs.api.user.dto.response.UserResponse;
import com.nextdocs.api.user.entity.User;
import com.nextdocs.api.user.service.ProfileService;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(ProfileController.class)
@Import({
    com.nextdocs.api.security.SecurityConfig.class,
    com.nextdocs.api.common.cache.CaffeineCacheStore.class,
    com.nextdocs.api.security.ratelimit.InMemoryRateLimiter.class
})
class ProfileControllerTest {

    private static final byte[] PNG_BYTES = {(byte) 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A};

    private static final String AVATAR_ID = "3f4b0c1e-0d9a-4c47-9f2e-0b1d5a6c7e8f";

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private ProfileService profileService;

    /** Required by JwtAuthenticationFilter (loaded in the web slice). */
    @MockitoBean
    private JwtTokenProvider jwtTokenProvider;

    /** Required by JwtAuthenticationFilter. */
    @MockitoBean
    private WorkspaceMemberRepository memberRepository;

    private UUID userId;
    private UserPrincipal principal;
    private UserResponse profile;

    @BeforeEach
    void setUp() {
        User user = User.builder()
                .email("ada@example.com")
                .displayName("Ada Lovelace")
                .passwordHash("$2a$12$hash")
                .build();
        user.setId(UUID.randomUUID());
        userId = user.getId();
        principal = UserPrincipal.from(user);
        profile = new UserResponse(userId, "ada@example.com", "Ada Lovelace", null);
    }

    @Test
    void me_returnsTheSignedInAccount() throws Exception {
        when(profileService.getProfile(userId)).thenReturn(profile);

        mockMvc.perform(get("/api/v1/users/me").with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.email").value("ada@example.com"));
    }

    @Test
    void me_withoutASession_isUnauthorized() throws Exception {
        mockMvc.perform(get("/api/v1/users/me")).andExpect(status().isUnauthorized());
    }

    @Test
    void updateProfile_returnsTheUpdatedAccount() throws Exception {
        when(profileService.updateDisplayName(userId, "Ada L")).thenReturn(profile);

        mockMvc.perform(patch("/api/v1/users/me")
                        .with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\":\"Ada L\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.displayName").value("Ada Lovelace"));
    }

    @Test
    void updateProfile_withBlankName_returns400() throws Exception {
        mockMvc.perform(patch("/api/v1/users/me")
                        .with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\":\"   \"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    void updateProfile_withoutASession_isUnauthorized() throws Exception {
        mockMvc.perform(patch("/api/v1/users/me")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\":\"Ada L\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void uploadAvatar_returnsTheAccountWithItsNewPhoto() throws Exception {
        UserResponse withPhoto = new UserResponse(
                userId, "ada@example.com", "Ada Lovelace", "/api/v1/users/" + userId + "/avatar?v=" + AVATAR_ID);
        when(profileService.replaceAvatar(eq(userId), any())).thenReturn(withPhoto);

        mockMvc.perform(multipart(org.springframework.http.HttpMethod.PUT, "/api/v1/users/me/avatar")
                        .file(new org.springframework.mock.web.MockMultipartFile(
                                "file", "a.png", "image/png", PNG_BYTES))
                        // A browser FormData always declares a length; MockMvc's multipart
                        // request has none, and the rate limiter refuses a chunked upload.
                        .with(request -> {
                            ((org.springframework.mock.web.MockHttpServletRequest) request).setContent(PNG_BYTES);
                            return request;
                        })
                        .with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.avatarUrl").value(withPhoto.avatarUrl()));
    }

    @Test
    void deleteAvatar_returnsTheAccountWithoutAPhoto() throws Exception {
        when(profileService.removeAvatar(userId)).thenReturn(profile);

        mockMvc.perform(delete("/api/v1/users/me/avatar").with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true));
    }

    @Test
    void avatar_isReadableWithoutASession() throws Exception {
        when(profileService.openAvatar(userId))
                .thenReturn(new ProfileService.Avatar(
                        new StoredAttachment(new ByteArrayResource(PNG_BYTES), PNG_BYTES.length, true),
                        "image/png",
                        AVATAR_ID));

        mockMvc.perform(get("/api/v1/users/{userId}/avatar", userId))
                .andExpect(status().isOk())
                .andExpect(content().contentType("image/png"))
                .andExpect(header().string("ETag", "\"" + AVATAR_ID + "\""))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                // The digest-prefixed URL is what lets this be cached for a day.
                .andExpect(header().string("Cache-Control", "max-age=86400, public"))
                .andExpect(content().bytes(PNG_BYTES));
    }

    @Test
    void avatar_answersNotModifiedForACachedCopy() throws Exception {
        when(profileService.openAvatar(userId))
                .thenReturn(new ProfileService.Avatar(
                        new StoredAttachment(new ByteArrayResource(PNG_BYTES), PNG_BYTES.length, true),
                        "image/png",
                        AVATAR_ID));

        mockMvc.perform(get("/api/v1/users/{userId}/avatar", userId).header("If-None-Match", "\"" + AVATAR_ID + "\""))
                .andExpect(status().isNotModified());
    }

    @Test
    void avatar_withAnUnparseableStoredType_fallsBackToOctetStream() throws Exception {
        when(profileService.openAvatar(userId))
                .thenReturn(new ProfileService.Avatar(
                        new StoredAttachment(new ByteArrayResource(PNG_BYTES), PNG_BYTES.length, true),
                        "not a media type",
                        AVATAR_ID));

        // A corrupted column must still serve bytes rather than answer 500.
        mockMvc.perform(get("/api/v1/users/{userId}/avatar", userId))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", MediaType.APPLICATION_OCTET_STREAM_VALUE))
                .andExpect(content().bytes(PNG_BYTES));
    }

    @Test
    void avatar_whenTheAccountHasNoPhoto_isNotFound() throws Exception {
        when(profileService.openAvatar(userId)).thenThrow(new ApiException(ErrorCode.NOT_FOUND));

        mockMvc.perform(get("/api/v1/users/{userId}/avatar", userId)).andExpect(status().isNotFound());
    }
}
