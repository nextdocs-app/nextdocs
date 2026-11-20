package com.nextdocs.api.user.controller;

import com.nextdocs.api.common.response.ApiResponse;
import com.nextdocs.api.security.UserPrincipal;
import com.nextdocs.api.user.dto.request.UpdateProfileRequest;
import com.nextdocs.api.user.dto.response.UserResponse;
import com.nextdocs.api.user.service.ProfileService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.time.Duration;
import java.util.Objects;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.multipart.MultipartFile;

/**
 * The account's own profile, plus the one route that serves photos to everybody.
 *
 * <p>The writes live under {@code /api/v1/users} rather than {@code /api/v1/auth}: the
 * rate limiter buckets everything under {@code /auth/} into the strict login budget, and
 * an image upload does not belong in the same allowance as sign-in attempts.
 */
@Tag(name = "Profile", description = "Display name and profile photo of the signed-in account")
@RestController
@RequestMapping("/api/v1/users")
@RequiredArgsConstructor
public class ProfileController {

    /** Photo of one account. Anonymous, because an {@code <img>} tag cannot send a token. */
    public static final String AVATAR_PATH = "/{userId}/avatar";

    private final ProfileService profileService;

    @Operation(
            summary = "Get the signed-in account",
            description = "Returns the same shape registration, login and token refresh return, so"
                    + " a client can re-read the profile without re-authenticating.",
            security = @SecurityRequirement(name = "bearerAuth"),
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Profile returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Not authenticated")
            })
    @GetMapping("/me")
    public ResponseEntity<ApiResponse<UserResponse>> me(@AuthenticationPrincipal UserPrincipal principal) {
        UserPrincipal caller = requirePrincipal(principal);
        return ResponseEntity.ok(ApiResponse.ok(profileService.getProfile(caller.getId())));
    }

    @Operation(
            summary = "Change the display name",
            description = "Renames the account everywhere a person is shown. The name is stored"
                    + " once and joined by member lists, comments and share panels, so no other"
                    + " record needs rewriting.",
            security = @SecurityRequirement(name = "bearerAuth"),
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Profile updated"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "400",
                        description = "Blank or oversized display name"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Not authenticated")
            })
    @PatchMapping("/me")
    public ResponseEntity<ApiResponse<UserResponse>> updateProfile(
            @AuthenticationPrincipal UserPrincipal principal, @Valid @RequestBody UpdateProfileRequest request) {
        UserPrincipal caller = requirePrincipal(principal);
        return ResponseEntity.ok(ApiResponse.ok(
                profileService.updateDisplayName(caller.getId(), request.displayName()), "Profile updated."));
    }

    @Operation(
            summary = "Upload a profile photo",
            description = "Replaces the account photo. Only raster images (PNG, JPEG, GIF, WebP,"
                    + " AVIF) up to the configured limit are accepted; the bytes are sniffed, so"
                    + " a raster label over other content is refused.",
            security = @SecurityRequirement(name = "bearerAuth"),
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Photo stored; the profile carries its new URL"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "400",
                        description = "Empty file or unsupported image type"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "413",
                        description = "Photo exceeds the configured size limit")
            })
    @PutMapping(value = "/me/avatar", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ApiResponse<UserResponse>> uploadAvatar(
            @AuthenticationPrincipal UserPrincipal principal, @RequestPart("file") MultipartFile file) {
        UserPrincipal caller = requirePrincipal(principal);
        return ResponseEntity.ok(
                ApiResponse.ok(profileService.replaceAvatar(caller.getId(), file), "Profile photo updated."));
    }

    @Operation(
            summary = "Remove the profile photo",
            description = "Drops the uploaded photo, so the account falls back to generated initials.",
            security = @SecurityRequirement(name = "bearerAuth"),
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Photo removed"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Not authenticated")
            })
    @DeleteMapping("/me/avatar")
    public ResponseEntity<ApiResponse<UserResponse>> deleteAvatar(@AuthenticationPrincipal UserPrincipal principal) {
        UserPrincipal caller = requirePrincipal(principal);
        return ResponseEntity.ok(ApiResponse.ok(profileService.removeAvatar(caller.getId()), "Profile photo removed."));
    }

    /**
     * Serves a profile photo anonymously.
     *
     * <p>Public on purpose: share-link visitors see comment authors, and a browser
     * {@code <img>} cannot attach an Authorization header. The URL is a capability-free
     * path for the same reason — there is nothing confidential in an avatar, and a signed
     * URL would expire inside a session that stores it.
     *
     * <p>The photo's version is both the strong ETag and the URL's {@code ?v=}, so a
     * cached copy never outlives its own version: replacing the photo changes the URL the
     * API hands out, and an old URL revalidated against its pinned ETag answers 304.
     */
    @Operation(
            summary = "Get a profile photo",
            description = "Streams the account's cached photo. Anonymous; 404 when the account has"
                    + " no uploaded photo and should fall back to initials.",
            security = {},
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Image bytes"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "304",
                        description = "Caller's cached copy is still current"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "No uploaded photo for this account")
            })
    @SecurityRequirements({})
    @GetMapping(AVATAR_PATH)
    public ResponseEntity<Resource> avatar(@PathVariable UUID userId, WebRequest request) {
        ProfileService.Avatar avatar = profileService.openAvatar(userId);
        // The version is the storage id, so it is always there: one value doubles as the
        // cache-busting query parameter, the ETag and the file name.
        String etag = avatar.version();
        // Sets the 304 itself (and the validator headers) when the caller is up to date.
        if (request.checkNotModified(etag)) {
            return null;
        }

        ResponseEntity.BodyBuilder response = ResponseEntity.ok()
                // A day is safe because the URL carries the version: a replacement is a
                // different URL, so nobody is left holding a stale photo.
                .cacheControl(CacheControl.maxAge(Duration.ofDays(1)).cachePublic())
                .contentType(parseContentType(avatar.contentType()))
                // Inline only for a sniffed raster type, and inert even if the bytes are a
                // polyglot: nosniff plus a sandbox CSP is what keeps that guarantee.
                .header(HttpHeaders.CONTENT_DISPOSITION, "inline")
                .header("X-Content-Type-Options", "nosniff")
                .header("Content-Security-Policy", "default-src 'none'; sandbox")
                .eTag("\"" + etag + "\"");
        return response.body(avatar.stored().resource());
    }

    private static MediaType parseContentType(String contentType) {
        try {
            return MediaType.parseMediaType(contentType);
        } catch (IllegalArgumentException ex) {
            return MediaType.APPLICATION_OCTET_STREAM;
        }
    }

    private static UserPrincipal requirePrincipal(UserPrincipal principal) {
        return Objects.requireNonNull(principal, "Authentication is required to change a profile.");
    }
}
