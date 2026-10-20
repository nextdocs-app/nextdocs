package com.nextdocs.api.space.dto.request;

import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.pageicon.dto.request.PageIconRequest;
import com.nextdocs.api.space.entity.SpaceAccessMode;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

@Schema(description = "Request body for creating a space")
public record SpaceCreateRequest(
        @Schema(description = "Space name", example = "Engineering")
        @NotBlank(message = "Name is required")
        @Size(max = 255, message = "Name must be at most 255 characters")
        // The name is rendered in navigation and email-adjacent surfaces; control
        // characters have no place in an identity and would break layout there.
        @Pattern(regexp = "^[^\\p{Cntrl}]*$", message = "Name must not contain control characters")
        String name,

        @Schema(description = "Space icon assignment. Null means no icon.")
        PageIconRequest icon,

        @Schema(
                description = "Who may read the space's pages. Defaults to CUSTOM: only listed members.",
                example = "PUBLIC")
        SpaceAccessMode accessMode,

        @Schema(
                description = "Level every workspace member inherits while the space is PUBLIC. "
                        + "Defaults to VIEW; OWNER and NO_ACCESS are rejected.")
        DocumentAccessLevel everyoneAccessLevel) {}
