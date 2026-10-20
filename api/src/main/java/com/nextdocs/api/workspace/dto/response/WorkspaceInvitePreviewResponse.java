package com.nextdocs.api.workspace.dto.response;

import com.nextdocs.api.workspace.entity.WorkspaceRole;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.OffsetDateTime;

@Schema(description = "Public preview of an invitation link, resolved before the join form is filled")
public record WorkspaceInvitePreviewResponse(
        @Schema(description = "Address the link admits; the join form is fixed to it", example = "jane@example.com")
        String email,

        @Schema(description = "Workspace the invitee is joining", example = "NextDocs")
        String workspaceName,

        WorkspaceRole role,

        @Schema(description = "When the link lapses") OffsetDateTime expiresAt) {}
