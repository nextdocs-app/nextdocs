package com.nextdocs.api.workspace.dto.request;

import com.nextdocs.api.pageicon.dto.request.PageIconRequest;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

@Schema(description = "Request body for updating the current workspace")
public record WorkspaceUpdateRequest(
        @Schema(description = "Workspace name. Absent leaves it unchanged.", example = "NextDocs")
        @Size(max = 255, message = "Name must be at most 255 characters")
        // The name is interpolated into email subjects; CR/LF there would be header
        // injection, and other control characters have no place in an identity.
        @Pattern(regexp = "^[^\\p{Cntrl}]*$", message = "Name must not contain control characters")
        String name,

        @Schema(
                description = "Workspace icon assignment. Absent leaves the icon unchanged; "
                        + "a value with a null type clears it.")
        PageIconRequest icon) {}
