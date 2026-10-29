package com.nextdocs.api.workspace.dto.response;

import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.pageicon.dto.response.PageIconResponse;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;

@Schema(description = "Summary of a space a member belongs to")
public record WorkspaceMemberSpaceSummaryResponse(
        @Schema(description = "Space id") UUID id,
        @Schema(description = "Space name") String name,
        @Schema(description = "Space icon, when set") PageIconResponse icon,

        @Schema(description = "Member access level in the space")
        DocumentAccessLevel accessLevel) {}
