package com.nextdocs.api.workspace.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

@Schema(description = "A flat workspace group and its members")
public record WorkspaceGroupResponse(
        UUID id, String name, List<Member> members, OffsetDateTime createdAt, OffsetDateTime updatedAt) {

    @Schema(description = "A group member")
    public record Member(UUID userId, String email, String displayName, String avatarUrl) {}
}
