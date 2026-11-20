package com.nextdocs.api.user.dto.response;

import com.nextdocs.api.user.entity.User;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;

@Schema(description = "A person's identity, as every surface in the app names them")
public record UserResponse(
        @Schema(description = "User ID") UUID id,

        @Schema(description = "Email address") String email,

        @Schema(description = "Display name") String displayName,

        @Schema(description = "Profile photo URL, or null for generated initials")
        String avatarUrl) {

    /**
     * The one projection of a {@link User}, used by registration, login, token refresh
     * and the profile endpoints. It lives here rather than on a service so no feature has
     * to reach into another feature's service to build a response.
     */
    public static UserResponse from(User user) {
        return new UserResponse(user.getId(), user.getEmail(), user.getDisplayName(), user.getAvatarUrl());
    }
}
