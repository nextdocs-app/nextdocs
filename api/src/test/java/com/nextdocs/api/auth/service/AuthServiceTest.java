package com.nextdocs.api.auth.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
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
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.entity.WorkspaceInvite;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import com.nextdocs.api.workspace.service.WorkspaceAccessService;
import com.nextdocs.api.workspace.service.WorkspaceInviteService;
import com.nextdocs.api.workspace.service.WorkspaceService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.OffsetDateTime;
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

    @Mock
    private WorkspaceService workspaceService;

    @Mock
    private WorkspaceAccessService accessService;

    @Mock
    private WorkspaceInviteService inviteService;

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

    private static WorkspaceInvite invite(WorkspaceRole role) {
        Workspace workspace =
                Workspace.builder().id(UUID.randomUUID()).name("NextDocs").build();
        User createdBy = User.builder()
                .email("owner@example.com")
                .displayName("Owner")
                .passwordHash("$2a$12$encoded")
                .build();
        createdBy.setId(UUID.randomUUID());
        return WorkspaceInvite.builder()
                .id(UUID.randomUUID())
                .workspace(workspace)
                .email("alice@example.com")
                .role(role)
                .tokenHash("stored-token-hash")
                .createdBy(createdBy)
                .expiresAt(OffsetDateTime.now().plusDays(7))
                .build();
    }

    @Test
    void register_onFreshInstance_bootstrapsWithoutInvite() {
        stubAccessTokenGeneration();
        RegisterRequest req = new RegisterRequest("Alice@Example.com", "Alice", "password123", null);
        when(accessService.isInitialized()).thenReturn(false);
        when(userRepository.existsByEmail("alice@example.com")).thenReturn(false);
        when(passwordEncoder.encode("password123")).thenReturn("$2a$12$encoded");
        when(workspaceService.bootstrapFirstUser(any(User.class))).thenReturn(true);

        AuthResponse authResponse = authService.register(req, request, response);

        assertThat(authResponse.accessToken()).isEqualTo("access.token.jwt");
        assertThat(authResponse.tokenType()).isEqualTo("Bearer");
        assertThat(authResponse.expiresIn()).isEqualTo(900L);
        // Ownership is unproven: the first account may administer the instance, but
        // email_verified stays false until some flow actually verifies the mailbox.
        verify(userRepository, never()).save(any());
        verify(workspaceService)
                .bootstrapFirstUser(argThat(u -> u.getEmail().equals("alice@example.com") && !u.isEmailVerified()));
        verifyNoInteractions(inviteService);
    }

    @Test
    void register_bootstrap_whenAnotherRegistrationWonTheRace_throwsInviteRequired() {
        RegisterRequest req = new RegisterRequest("alice@example.com", "Alice", "password123", null);
        when(accessService.isInitialized()).thenReturn(false);
        when(userRepository.existsByEmail("alice@example.com")).thenReturn(false);
        when(passwordEncoder.encode(any())).thenReturn("$2a$12$encoded");
        when(workspaceService.bootstrapFirstUser(any(User.class))).thenReturn(false);

        // The loser holds no invite, so it must not be admitted; the bootstrap call
        // inserts nothing once it sees the winner's membership under the lock.
        assertThatThrownBy(() -> authService.register(req, request, response))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode())
                        .isEqualTo(ErrorCode.REGISTRATION_INVITE_REQUIRED));
        verify(workspaceService, never()).addMember(any(), any(), any());
    }

    @Test
    void register_normalisesEmailToLowercase() {
        stubAccessTokenGeneration();
        RegisterRequest req = new RegisterRequest("  Ａｌｉｃｅ＠Ｅｘａｍｐｌｅ．ＣＯＭ  ", "Alice", "password123", null);
        when(accessService.isInitialized()).thenReturn(false);
        when(userRepository.existsByEmail("alice@example.com")).thenReturn(false);
        when(passwordEncoder.encode(any())).thenReturn("$2a$12$encoded");
        when(workspaceService.bootstrapFirstUser(any(User.class))).thenReturn(true);

        authService.register(req, request, response);

        verify(workspaceService).bootstrapFirstUser(argThat(u -> u.getEmail().equals("alice@example.com")));
    }

    @Test
    void register_stripsWhitespaceFromDisplayName() {
        stubAccessTokenGeneration();
        RegisterRequest req = new RegisterRequest("alice@example.com", "  Alice  ", "password123", null);
        when(accessService.isInitialized()).thenReturn(false);
        when(userRepository.existsByEmail("alice@example.com")).thenReturn(false);
        when(passwordEncoder.encode(any())).thenReturn("$2a$12$encoded");
        when(workspaceService.bootstrapFirstUser(any(User.class))).thenReturn(true);

        authService.register(req, request, response);

        verify(workspaceService)
                .bootstrapFirstUser(argThat(u -> u.getDisplayName().equals("Alice")));
    }

    @Test
    void register_throwsConflict_whenEmailAlreadyExistsOnFreshInstance() {
        RegisterRequest req = new RegisterRequest("alice@example.com", "Alice", "password123", null);
        when(accessService.isInitialized()).thenReturn(false);
        when(userRepository.existsByEmail("alice@example.com")).thenReturn(true);

        assertThatThrownBy(() -> authService.register(req, request, response))
                .isInstanceOf(ApiException.class)
                .satisfies(
                        ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.EMAIL_ALREADY_EXISTS));
    }

    @Test
    void register_withInvite_createsUserAndMembershipWithInviteRole() {
        stubAccessTokenGeneration();
        RegisterRequest req = new RegisterRequest("Alice@Example.com", "  Alice  ", "password123", "raw-token");
        WorkspaceInvite invite = invite(WorkspaceRole.ADMIN);
        when(accessService.isInitialized()).thenReturn(true);
        when(inviteService.requireUsable("raw-token", "alice@example.com")).thenReturn(invite);
        when(userRepository.findByEmail("alice@example.com")).thenReturn(Optional.empty());
        when(passwordEncoder.encode("password123")).thenReturn("$2a$12$encoded");
        when(userRepository.save(any(User.class))).thenReturn(persistedUser);

        AuthResponse authResponse = authService.register(req, request, response);

        assertThat(authResponse.accessToken()).isEqualTo("access.token.jwt");
        // Accepting the invitation link proves the mailbox and the claim happens before
        // the membership is granted.
        verify(userRepository).save(argThat(User::isEmailVerified));
        verify(inviteService)
                .consume(eq(invite), argThat(u -> u.getEmail().equals("alice@example.com")), eq("raw-token"));
        verify(workspaceService).addMember(eq(invite.getWorkspace()), any(User.class), eq(WorkspaceRole.ADMIN));
        verify(workspaceService, never()).bootstrapFirstUser(any());
    }

    @Test
    void register_withoutInvite_whenInstanceIsInitialized_throwsInviteRequired() {
        RegisterRequest req = new RegisterRequest("alice@example.com", "Alice", "password123", null);
        when(accessService.isInitialized()).thenReturn(true);

        assertThatThrownBy(() -> authService.register(req, request, response))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode())
                        .isEqualTo(ErrorCode.REGISTRATION_INVITE_REQUIRED));
        // No lookup happens for an absent token: the gate refusal stands on its own.
        verifyNoInteractions(inviteService);
        verify(userRepository, never()).save(any());
    }

    @Test
    void register_withUnusableInviteToken_throwsInvalidInvite() {
        RegisterRequest req = new RegisterRequest("alice@example.com", "Alice", "password123", "garbage");
        when(accessService.isInitialized()).thenReturn(true);
        when(inviteService.requireUsable("garbage", "alice@example.com"))
                .thenThrow(new ApiException(ErrorCode.INVALID_INVITE));

        assertThatThrownBy(() -> authService.register(req, request, response))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.INVALID_INVITE));
        verify(userRepository, never()).save(any());
    }

    @Test
    void register_withInvite_forActiveAccount_throwsConflict() {
        RegisterRequest req = new RegisterRequest("alice@example.com", "Alice", "password123", "raw-token");
        when(accessService.isInitialized()).thenReturn(true);
        when(inviteService.requireUsable("raw-token", "alice@example.com")).thenReturn(invite(WorkspaceRole.MEMBER));
        when(userRepository.findByEmail("alice@example.com")).thenReturn(Optional.of(persistedUser));

        assertThatThrownBy(() -> authService.register(req, request, response))
                .isInstanceOf(ApiException.class)
                .satisfies(
                        ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.EMAIL_ALREADY_EXISTS));
        verify(inviteService, never()).consume(any(), any(), any());
    }

    @Test
    void register_withInvite_reactivatesRemovedAccountWithNewCredentials() {
        stubAccessTokenGeneration();
        RegisterRequest req = new RegisterRequest("alice@example.com", "Alice Again", "newpassword", "raw-token");
        persistedUser.setActive(false);
        WorkspaceInvite invite = invite(WorkspaceRole.MEMBER);
        when(accessService.isInitialized()).thenReturn(true);
        when(inviteService.requireUsable("raw-token", "alice@example.com")).thenReturn(invite);
        when(userRepository.findByEmail("alice@example.com")).thenReturn(Optional.of(persistedUser));
        when(passwordEncoder.encode("newpassword")).thenReturn("$2a$12$new");

        authService.register(req, request, response);

        assertThat(persistedUser.isActive()).isTrue();
        assertThat(persistedUser.getDisplayName()).isEqualTo("Alice Again");
        assertThat(persistedUser.getPasswordHash()).isEqualTo("$2a$12$new");
        assertThat(persistedUser.isEmailVerified()).isTrue();
        verify(inviteService).consume(invite, persistedUser, "raw-token");
        verify(workspaceService).addMember(invite.getWorkspace(), persistedUser, WorkspaceRole.MEMBER);
        verify(workspaceService, never()).bootstrapFirstUser(any());
    }

    @Test
    void register_withInvite_thatLostTheClaimRace_propagatesInvalidInvite() {
        RegisterRequest req = new RegisterRequest("alice@example.com", "Alice", "password123", "raw-token");
        WorkspaceInvite invite = invite(WorkspaceRole.MEMBER);
        when(accessService.isInitialized()).thenReturn(true);
        when(inviteService.requireUsable("raw-token", "alice@example.com")).thenReturn(invite);
        when(userRepository.findByEmail("alice@example.com")).thenReturn(Optional.empty());
        when(passwordEncoder.encode(any())).thenReturn("$2a$12$encoded");
        when(userRepository.save(any(User.class))).thenReturn(persistedUser);
        doThrow(new ApiException(ErrorCode.INVALID_INVITE)).when(inviteService).consume(any(), any(), any());

        assertThatThrownBy(() -> authService.register(req, request, response))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.INVALID_INVITE));
        // The membership is granted only after the single-use claim succeeded.
        verify(workspaceService, never()).addMember(any(), any(), any());
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
        // NFKC folds full-width characters, then the result is trimmed and lowercased:
        // the same canonical form the invite flow mints and redeems.
        LoginRequest req = new LoginRequest("  Ａｌｉｃｅ＠Ｅｘａｍｐｌｅ．ＣＯＭ  ", "password123");
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
