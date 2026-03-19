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
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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

    @Transactional
    public AuthResponse register(RegisterRequest request, HttpServletRequest req, HttpServletResponse res) {

        String normalizedEmail = request.email().toLowerCase().strip();

        if (userRepository.existsByEmail(normalizedEmail)) {
            throw new ApiException(ErrorCode.EMAIL_ALREADY_EXISTS);
        }

        User user = User.builder()
                .email(normalizedEmail)
                .displayName(request.displayName().strip())
                .passwordHash(passwordEncoder.encode(request.password()))
                .build();

        userRepository.save(user);
        log.info("New user registered: {}", user.getId());

        return buildAuthResponse(user, req, res);
    }

    @Transactional
    public AuthResponse login(LoginRequest request, HttpServletRequest req, HttpServletResponse res) {

        Optional<User> maybeUser =
                userRepository.findByEmail(request.email().toLowerCase().strip());

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
