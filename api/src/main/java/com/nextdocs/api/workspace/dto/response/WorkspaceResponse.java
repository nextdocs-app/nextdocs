package com.nextdocs.api.workspace.dto.response;

import com.nextdocs.api.pageicon.dto.response.PageIconResponse;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;

@Schema(description = "The current workspace and the caller's role in it")
public record WorkspaceResponse(
        @Schema(description = "Workspace id") UUID id,

        @Schema(description = "Workspace name", example = "NextDocs")
        String name,

        @Schema(description = "Workspace icon. Null when none is set.")
        PageIconResponse icon,

        @Schema(description = "The requesting member's role: OWNER, ADMIN, or MEMBER")
        WorkspaceRole role,

        @Schema(description = "Number of members", example = "4")
        long memberCount) {}
