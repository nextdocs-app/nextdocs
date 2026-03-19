package com.nextdocs.api.auth.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.*;

import com.nextdocs.api.auth.dto.request.LoginRequest;
import com.nextdocs.api.auth.dto.request.RegisterRequest;
import com.nextdocs.api.auth.dto.response.AuthResponse;
import com.nextdocs.api.auth.dto.response.UserResponse;
import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.auth.security.JwtTokenProvider;
import com.nextdocs.api.auth.security.UserPrincipal;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;

@ExtendWith(MockitoExtension.class)
class AuthServiceTest {

    @Mock
    private UserRepository userRepository;

    @Mock
    private PasswordEncoder passwordEncoder;

    @Mock
    private JwtTokenProvider jwtTokenProvider;

    @Mock
    private TokenService tokenService;

    @InjectMocks
    private AuthService authService;

    @Mock
    private HttpServletRequest request;

    @Mock
    private HttpServletResponse response;

    private User persistedUser;

    @BeforeEach
    void setUp() {
        persistedUser = User.builder()
                .email("alice@example.com")
                .displayName("Alice")
                .passwordHash("$2a$12$encoded")
                .build();
        persistedUser.setId(UUID.randomUUID());
    }

    private void stubAccessTokenGeneration() {
        when(jwtTokenProvider.getAccessTokenExpiryMs()).thenReturn(900_000L);
        when(jwtTokenProvider.generateAccessToken(any(), any())).thenReturn("access.token.jwt");
    }

    @Test
    void register_success_returnsAuthResponse() {
        stubAccessTokenGeneration();
        RegisterRequest req = new RegisterRequest("Alice@Example.com", "Alice", "password123");
        when(userRepository.existsByEmail("alice@example.com")).thenReturn(false);
        when(passwordEncoder.encode("password123")).thenReturn("$2a$12$encoded");
        when(userRepository.save(any(User.class))).thenReturn(persistedUser);

        AuthResponse authResponse = authService.register(req, request, response);

        assertThat(authResponse.accessToken()).isEqualTo("access.token.jwt");
        assertThat(authResponse.tokenType()).isEqualTo("Bearer");
        assertThat(authResponse.expiresIn()).isEqualTo(900L);
    }

    @Test
    void register_normalisesEmailToLowercase() {
        stubAccessTokenGeneration();
        RegisterRequest req = new RegisterRequest("Alice@Example.COM", "Alice", "password123");
        when(userRepository.existsByEmail("alice@example.com")).thenReturn(false);
        when(passwordEncoder.encode(any())).thenReturn("$2a$12$encoded");
        when(userRepository.save(any(User.class))).thenReturn(persistedUser);

        authService.register(req, request, response);

        verify(userRepository).save(argThat(u -> u.getEmail().equals("alice@example.com")));
    }

    @Test
    void register_stripsWhitespaceFromDisplayName() {
        stubAccessTokenGeneration();
        RegisterRequest req = new RegisterRequest("alice@example.com", "  Alice  ", "password123");
        when(userRepository.existsByEmail("alice@example.com")).thenReturn(false);
        when(passwordEncoder.encode(any())).thenReturn("$2a$12$encoded");
        when(userRepository.save(any(User.class))).thenReturn(persistedUser);

        authService.register(req, request, response);

        verify(userRepository).save(argThat(u -> u.getDisplayName().equals("Alice")));
    }

    @Test
    void register_throwsConflict_whenEmailAlreadyExists() {
        RegisterRequest req = new RegisterRequest("alice@example.com", "Alice", "password123");
        when(userRepository.existsByEmail("alice@example.com")).thenReturn(true);

        assertThatThrownBy(() -> authService.register(req, request, response))
                .isInstanceOf(ApiException.class)
                .satisfies(
                        ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.EMAIL_ALREADY_EXISTS));
    }

    @Test
    void login_success_returnsAuthResponse() {
        stubAccessTokenGeneration();
        LoginRequest req = new LoginRequest("alice@example.com", "password123");
        when(userRepository.findByEmail("alice@example.com")).thenReturn(Optional.of(persistedUser));
        when(passwordEncoder.matches("password123", "$2a$12$encoded")).thenReturn(true);

        AuthResponse authResponse = authService.login(req, request, response);

        assertThat(authResponse.accessToken()).isEqualTo("access.token.jwt");
    }

    @Test
    void login_normalisesEmailBeforeLookup() {
        stubAccessTokenGeneration();
        LoginRequest req = new LoginRequest("  Alice@Example.COM  ", "password123");
        when(userRepository.findByEmail("alice@example.com")).thenReturn(Optional.of(persistedUser));
        when(passwordEncoder.matches("password123", "$2a$12$encoded")).thenReturn(true);

        authService.login(req, request, response);

        verify(userRepository).findByEmail("alice@example.com");
    }

    @Test
    void login_throwsUnauthorized_whenUserNotFound() {
        LoginRequest req = new LoginRequest("nobody@example.com", "password");
        when(userRepository.findByEmail("nobody@example.com")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> authService.login(req, request, response))
                .isInstanceOf(ApiException.class)
                .satisfies(
                        ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.INVALID_CREDENTIALS));
    }

    @Test
    void login_throwsForbidden_whenAccountDisabled() {
        persistedUser.setActive(false);
        LoginRequest req = new LoginRequest("alice@example.com", "password123");
        when(userRepository.findByEmail("alice@example.com")).thenReturn(Optional.of(persistedUser));
        when(passwordEncoder.matches("password123", "$2a$12$encoded")).thenReturn(true);

        assertThatThrownBy(() -> authService.login(req, request, response))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.ACCOUNT_DISABLED));
    }

    @Test
    void login_throwsUnauthorized_whenPasswordDoesNotMatch() {
        LoginRequest req = new LoginRequest("alice@example.com", "wrongpass");
        when(userRepository.findByEmail("alice@example.com")).thenReturn(Optional.of(persistedUser));
        when(passwordEncoder.matches("wrongpass", "$2a$12$encoded")).thenReturn(false);

        assertThatThrownBy(() -> authService.login(req, request, response))
                .isInstanceOf(ApiException.class)
                .satisfies(
                        ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.INVALID_CREDENTIALS));
    }

    @Test
    void refresh_rotatesTokenAndReturnsNewAccessToken() {
        stubAccessTokenGeneration();
        when(tokenService.rotateRefreshToken(request, response)).thenReturn(persistedUser);

        AuthResponse authResponse = authService.refresh(request, response);

        assertThat(authResponse.accessToken()).isEqualTo("access.token.jwt");
        verify(jwtTokenProvider).generateAccessToken(persistedUser.getId(), persistedUser.getEmail());
    }

    @Test
    void logout_delegatesToTokenService() {
        authService.logout(request, response);

        verify(tokenService).revokeRefreshToken(request, response);
    }

    @Test
    void getMe_returnsUserResponse_forExistingPrincipal() {
        UserPrincipal principal = UserPrincipal.from(persistedUser);
        when(userRepository.findById(persistedUser.getId())).thenReturn(Optional.of(persistedUser));

        UserResponse userResponse = authService.getMe(principal);

        assertThat(userResponse.id()).isEqualTo(persistedUser.getId());
        assertThat(userResponse.email()).isEqualTo(persistedUser.getEmail());
        assertThat(userResponse.displayName()).isEqualTo(persistedUser.getDisplayName());
    }

    @Test
    void getMe_throwsNotFound_whenUserDoesNotExist() {
        UserPrincipal principal = UserPrincipal.from(persistedUser);
        when(userRepository.findById(persistedUser.getId())).thenReturn(Optional.empty());

        assertThatThrownBy(() -> authService.getMe(principal))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.NOT_FOUND));
    }

    @Test
    void toUserResponse_mapsAllFields() {
        persistedUser.setAvatarUrl("https://example.com/avatar.png");
        persistedUser.setEmailVerified(true);

        UserResponse resp = AuthService.toUserResponse(persistedUser);

        assertThat(resp.id()).isEqualTo(persistedUser.getId());
        assertThat(resp.email()).isEqualTo("alice@example.com");
        assertThat(resp.displayName()).isEqualTo("Alice");
        assertThat(resp.avatarUrl()).isEqualTo("https://example.com/avatar.png");
        assertThat(resp.emailVerified()).isTrue();
    }
}
