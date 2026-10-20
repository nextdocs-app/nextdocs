package com.nextdocs.api.space.dto.response;

import com.nextdocs.api.document.entity.DocumentAccessLevel;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.OffsetDateTime;
import java.util.UUID;

@Schema(description = "Space member entry")
public record SpaceMemberResponse(
        @Schema(description = "User ID") UUID userId,

        @Schema(description = "User email") String email,

        @Schema(description = "Display name") String displayName,

        @Schema(description = "Avatar URL, when set") String avatarUrl,

        @Schema(description = "Access level in the space") DocumentAccessLevel accessLevel,

        @Schema(description = "Membership creation timestamp")
        OffsetDateTime addedAt) {}
