package com.nextdocs.api.auth.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.nextdocs.api.auth.dto.response.AuthResponse;
import com.nextdocs.api.auth.dto.response.UserResponse;
import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.auth.security.JwtTokenProvider;
import com.nextdocs.api.auth.security.UserPrincipal;
import com.nextdocs.api.auth.service.AuthService;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(AuthController.class)
@Import({
    com.nextdocs.api.auth.security.SecurityConfig.class,
    com.nextdocs.api.common.cache.CaffeineCacheStore.class,
    com.nextdocs.api.auth.security.ratelimit.InMemoryRateLimiter.class
})
class AuthControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private AuthService authService;

    /** Required by JwtAuthenticationFilter (loaded in the web slice). */
    @MockitoBean
    private JwtTokenProvider jwtTokenProvider;

    /** Required by JwtAuthenticationFilter. */
    @MockitoBean
    private UserRepository userRepository;

    private User testUser;
    private UserPrincipal testPrincipal;
    private AuthResponse stubAuthResponse;
    private UserResponse stubUserResponse;

    @BeforeEach
    void setUp() {
        testUser = User.builder()
                .email("alice@example.com")
                .displayName("Alice")
                .passwordHash("$2a$12$hash")
                .build();
        testUser.setId(UUID.randomUUID());
        testPrincipal = UserPrincipal.from(testUser);

        stubUserResponse = new UserResponse(testUser.getId(), "alice@example.com", "Alice", null, false);
        stubAuthResponse = AuthResponse.of("access.token.jwt", 900L, stubUserResponse);
    }

    @Test
    void register_success_returns201WithAuthResponse() throws Exception {
        when(authService.register(any(), any(), any())).thenReturn(stubAuthResponse);

        mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                        {
                            "email": "alice@example.com",
                            "displayName": "Alice",
                            "password": "password123"
                        }
                        """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.accessToken").value("access.token.jwt"))
                .andExpect(jsonPath("$.data.tokenType").value("Bearer"))
                .andExpect(jsonPath("$.message").value("Account created."));
    }

    @Test
    void register_validationFailure_returns400() throws Exception {
        mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                        {
                            "email": "not-an-email",
                            "displayName": "A",
                            "password": "short"
                        }
                        """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    void register_emailAlreadyExists_returns409() throws Exception {
        when(authService.register(any(), any(), any())).thenThrow(new ApiException(ErrorCode.EMAIL_ALREADY_EXISTS));

        mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                        {
                            "email": "alice@example.com",
                            "displayName": "Alice",
                            "password": "password123"
                        }
                        """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error").value(ErrorCode.EMAIL_ALREADY_EXISTS.defaultMessage()));
    }

    @Test
    void login_success_returns200WithAuthResponse() throws Exception {
        when(authService.login(any(), any(), any())).thenReturn(stubAuthResponse);

        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                        {
                            "email": "alice@example.com",
                            "password": "password123"
                        }
                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.accessToken").value("access.token.jwt"));
    }

    @Test
    void login_invalidCredentials_returns401() throws Exception {
        when(authService.login(any(), any(), any())).thenThrow(new ApiException(ErrorCode.INVALID_CREDENTIALS));

        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                        {
                            "email": "alice@example.com",
                            "password": "wrongpassword"
                        }
                        """))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    void login_blankEmail_returns400() throws Exception {
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                        {
                            "email": "",
                            "password": "password123"
                        }
                        """))
                .andExpect(status().isBadRequest());
    }

    @Test
    void refresh_success_returns200WithNewAccessToken() throws Exception {
        when(authService.refresh(any(), any())).thenReturn(stubAuthResponse);

        mockMvc.perform(post("/api/v1/auth/refresh"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.accessToken").value("access.token.jwt"));
    }

    @Test
    void refresh_invalidToken_returns401() throws Exception {
        when(authService.refresh(any(), any())).thenThrow(new ApiException(ErrorCode.REFRESH_TOKEN_INVALID));

        mockMvc.perform(post("/api/v1/auth/refresh"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    void logout_returns204NoContent() throws Exception {
        doNothing().when(authService).logout(any(), any());

        mockMvc.perform(post("/api/v1/auth/logout").with(user(testPrincipal))).andExpect(status().isNoContent());

        verify(authService).logout(any(), any());
    }

    @Test
    void me_withAuthentication_returns200WithUserProfile() throws Exception {
        when(authService.getMe(any(UserPrincipal.class))).thenReturn(stubUserResponse);

        mockMvc.perform(get("/api/v1/auth/me").with(user(testPrincipal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.email").value("alice@example.com"))
                .andExpect(jsonPath("$.data.displayName").value("Alice"));
    }

    @Test
    void me_withoutAuthentication_returns401() throws Exception {
        mockMvc.perform(get("/api/v1/auth/me")).andExpect(status().isUnauthorized());
    }
}
