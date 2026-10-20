package com.nextdocs.api.workspace.dto.response;

import com.nextdocs.api.pageicon.dto.response.PageIconResponse;
import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "Public workspace identity for share pages")
public record WorkspaceBrandingResponse(
        @Schema(description = "Workspace name", example = "NextDocs")
        String name,

        @Schema(description = "Workspace icon. Null when none is set.")
        PageIconResponse icon) {}
