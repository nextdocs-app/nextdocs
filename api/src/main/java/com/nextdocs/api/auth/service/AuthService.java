package com.nextdocs.api.auth.service;

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
import com.nextdocs.api.common.util.EmailNormalizer;
import com.nextdocs.api.workspace.entity.WorkspaceInvite;
import com.nextdocs.api.workspace.service.WorkspaceAccessService;
import com.nextdocs.api.workspace.service.WorkspaceInviteService;
import com.nextdocs.api.workspace.service.WorkspaceService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Slf4j
@Service
@RequiredArgsConstructor
public class AuthService {

    // We do a dummy password has comparison when the email is not found in the database
    // to prevent timing side-channels that would otherwise reveal account existence.
    private static final String DUMMY_PASSWORD_HASH = "$2a$12$ixlTa/Lm5OauZIU4PLIuiO5wIbpnBWBLJZ0oJqj0SG.RP8kJgSE2";

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenProvider jwtTokenProvider;
    private final TokenService tokenService;
    private final WorkspaceService workspaceService;
    private final WorkspaceAccessService accessService;
    private final WorkspaceInviteService inviteService;

    /**
     * READ_COMMITTED is load-bearing: bootstrap pins that isolation so its re-check
     * after the V22 row lock sees the winner's committed membership. Under REPEATABLE
     * READ the post-lock check could still read the pre-lock snapshot and admit a
     * second owner.
     */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public AuthResponse register(RegisterRequest request, HttpServletRequest req, HttpServletResponse res) {

        String normalizedEmail = EmailNormalizer.normalize(request.email());

        // A fresh instance has nobody who could have issued an invite: the first account
        // bootstraps the workspace and owns it. Every later account is invite-gated.
        if (!accessService.isInitialized()) {
            if (userRepository.existsByEmail(normalizedEmail)) {
                throw new ApiException(ErrorCode.EMAIL_ALREADY_EXISTS);
            }
            User bootstrapUser = buildUser(request, normalizedEmail);
            // The check above is not serialized, so a concurrent first registration can
            // win it: bootstrapFirstUser inserts the account and re-checks under the
            // instance lock, so only one call wins. The loser rolls back without an
            // account row and answers like any other registration without an invite.
            // Ownership is unproven either way: the account stays email_verified = false
            // and can still sign in and administer the instance.
            if (!workspaceService.bootstrapFirstUser(bootstrapUser)) {
                throw new ApiException(ErrorCode.REGISTRATION_INVITE_REQUIRED);
            }
            log.info("New user registered: {}", bootstrapUser.getId());
            return buildAuthResponse(bootstrapUser, req, res);
        }

        // An initialized instance admits only the pending invite behind the presented
        // token, bound to the exact address. An absent token is a plain gate refusal
        // before any lookup.
        if (!StringUtils.hasText(request.inviteToken())) {
            throw new ApiException(ErrorCode.REGISTRATION_INVITE_REQUIRED);
        }
        WorkspaceInvite invite = inviteService.requireUsable(request.inviteToken(), normalizedEmail);

        Optional<User> existing = userRepository.findByEmail(normalizedEmail);
        if (existing.isPresent() && existing.get().isActive()) {
            throw new ApiException(ErrorCode.EMAIL_ALREADY_EXISTS);
        }
        User user = existing.map(u -> reactivate(u, request)).orElseGet(() -> buildUser(request, normalizedEmail));
        // Accepting the invitation link is proof of the invited mailbox: the only place
        // the flag becomes true in V1.
        user.setEmailVerified(true);
        userRepository.save(user);

        // Claim before granting the membership: a registration that loses the race for
        // a single-use invite must not leave a member behind. This method is one
        // transaction, so the claim rolls back with everything else on any failure.
        inviteService.consume(invite, user, request.inviteToken());
        workspaceService.addMember(invite.getWorkspace(), user, invite.getRole());
        log.info(
                "User {} joined workspace {} via invite {}",
                user.getId(),
                invite.getWorkspace().getId(),
                invite.getId());

        return buildAuthResponse(user, req, res);
    }

    @Transactional
    public AuthResponse login(LoginRequest request, HttpServletRequest req, HttpServletResponse res) {

        Optional<User> maybeUser = userRepository.findByEmail(EmailNormalizer.normalize(request.email()));

        if (maybeUser.isEmpty()) {
            // Perform a dummy hash comparison to keep response timing consistent
            // with the wrong-password path, preventing e-mail enumeration via
            // timing side-channels.
            passwordEncoder.matches(request.password(), DUMMY_PASSWORD_HASH);
            throw new ApiException(ErrorCode.INVALID_CREDENTIALS);
        }

        User user = maybeUser.get();

        if (!passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw new ApiException(ErrorCode.INVALID_CREDENTIALS);
        }

        if (!user.isActive()) {
            throw new ApiException(ErrorCode.ACCOUNT_DISABLED);
        }

        log.info("User logged in: {}", user.getId());
        return buildAuthResponse(user, req, res);
    }

    @Transactional
    public AuthResponse refresh(HttpServletRequest req, HttpServletResponse res) {
        User user = tokenService.rotateRefreshToken(req, res);
        String accessToken = jwtTokenProvider.generateAccessToken(user.getId(), user.getEmail());
        return AuthResponse.of(accessToken, jwtTokenProvider.getAccessTokenExpiryMs() / 1000, toUserResponse(user));
    }

    @Transactional
    public void logout(HttpServletRequest req, HttpServletResponse res) {
        tokenService.revokeRefreshToken(req, res);
    }

    public UserResponse getMe(UserPrincipal principal) {
        User user = userRepository.findById(principal.getId()).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
        return toUserResponse(user);
    }

    private User buildUser(RegisterRequest request, String normalizedEmail) {
        return User.builder()
                .email(normalizedEmail)
                .displayName(request.displayName().strip())
                .passwordHash(passwordEncoder.encode(request.password()))
                .build();
    }

    /**
     * Re-registration of a removed member: the removal deactivated the account, and an
     * invite for its email is how it comes back. The new credentials win and the
     * membership is re-added by the caller with the invite's role.
     */
    private User reactivate(User user, RegisterRequest request) {
        user.setDisplayName(request.displayName().strip());
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        user.setActive(true);
        return user;
    }

    private AuthResponse buildAuthResponse(User user, HttpServletRequest req, HttpServletResponse res) {
        String accessToken = jwtTokenProvider.generateAccessToken(user.getId(), user.getEmail());
        tokenService.issueRefreshToken(user, req, res);
        return AuthResponse.of(accessToken, jwtTokenProvider.getAccessTokenExpiryMs() / 1000, toUserResponse(user));
    }

    static UserResponse toUserResponse(User user) {
        return new UserResponse(
                user.getId(), user.getEmail(), user.getDisplayName(), user.getAvatarUrl(), user.isEmailVerified());
    }
}
