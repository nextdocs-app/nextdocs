package com.nextdocs.api.auth.controller;

import com.nextdocs.api.auth.dto.request.LoginRequest;
import com.nextdocs.api.auth.dto.request.RegisterRequest;
import com.nextdocs.api.auth.dto.response.AuthResponse;
import com.nextdocs.api.auth.dto.response.UserResponse;
import com.nextdocs.api.auth.security.UserPrincipal;
import com.nextdocs.api.auth.service.AuthService;
import com.nextdocs.api.common.response.ApiResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@Tag(name = "Authentication", description = "Register, login, token refresh, logout and profile")
@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    @Operation(
            summary = "Register a new account",
            description = "Creates a new user account with email + password.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "201",
                        description = "Account created. Access token returned; refresh token set as HTTP-only cookie."),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "400",
                        description = "Validation error"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "409",
                        description = "Email already registered"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "429",
                        description = "Too many requests")
            })
    @PostMapping("/register")
    public ResponseEntity<ApiResponse<AuthResponse>> register(
            @Valid @RequestBody RegisterRequest request, HttpServletRequest req, HttpServletResponse res) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(authService.register(request, req, res), "Account created."));
    }

    @Operation(
            summary = "Login with email + password",
            description =
                    "Authenticates the user. Returns an access token and sets the refresh token as HTTP-only cookie.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Login successful"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Invalid credentials"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "429",
                        description = "Too many requests")
            })
    @PostMapping("/login")
    public ResponseEntity<ApiResponse<AuthResponse>> login(
            @Valid @RequestBody LoginRequest request, HttpServletRequest req, HttpServletResponse res) {
        return ResponseEntity.ok(ApiResponse.ok(authService.login(request, req, res)));
    }

    @Operation(
            summary = "Refresh access token",
            description =
                    "Reads the refresh token from the HTTP-only cookie, rotates it, and returns a new access token.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Token refreshed"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Refresh token invalid or expired")
            })
    @PostMapping("/refresh")
    public ResponseEntity<ApiResponse<AuthResponse>> refresh(HttpServletRequest req, HttpServletResponse res) {
        return ResponseEntity.ok(ApiResponse.ok(authService.refresh(req, res)));
    }

    @Operation(
            summary = "Logout",
            description = "Revokes the refresh token and clears the cookie.",
            security = @SecurityRequirement(name = "bearerAuth"),
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "204",
                        description = "Logged out successfully")
            })
    @PostMapping("/logout")
    public ResponseEntity<Void> logout(HttpServletRequest req, HttpServletResponse res) {
        authService.logout(req, res);
        return ResponseEntity.noContent().build();
    }

    @Operation(
            summary = "Get current user profile",
            description = "Returns the authenticated user's profile. Requires a valid access token.",
            security = @SecurityRequirement(name = "bearerAuth"),
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "User profile returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Not authenticated")
            })
    @GetMapping("/me")
    public ResponseEntity<ApiResponse<UserResponse>> me(@AuthenticationPrincipal UserPrincipal principal) {
        return ResponseEntity.ok(ApiResponse.ok(authService.getMe(principal)));
    }
}
