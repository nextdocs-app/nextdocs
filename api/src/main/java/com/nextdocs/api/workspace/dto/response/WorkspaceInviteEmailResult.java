package com.nextdocs.api.workspace.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "Per-email outcome of an invite batch")
public record WorkspaceInviteEmailResult(
        @Schema(description = "Normalized email the result belongs to", example = "jane@example.com")
        String email,

        WorkspaceInviteStatus status,

        @Schema(description = "The created invite; only present for INVITED")
        WorkspaceInviteCreatedResponse invite) {

    public static WorkspaceInviteEmailResult invited(String email, WorkspaceInviteCreatedResponse invite) {
        return new WorkspaceInviteEmailResult(email, WorkspaceInviteStatus.INVITED, invite);
    }

    public static WorkspaceInviteEmailResult alreadyMember(String email) {
        return new WorkspaceInviteEmailResult(email, WorkspaceInviteStatus.ALREADY_MEMBER, null);
    }

    public static WorkspaceInviteEmailResult invalidEmail(String email) {
        return new WorkspaceInviteEmailResult(email, WorkspaceInviteStatus.INVALID_EMAIL, null);
    }
}
