package com.nextdocs.api.space.dto.request;

import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.pageicon.dto.request.PageIconRequest;
import com.nextdocs.api.space.entity.SpaceAccessMode;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

@Schema(description = "Request body for updating a space")
public record SpaceUpdateRequest(
        @Schema(description = "Space name. Absent leaves it unchanged.")
        @Size(max = 255, message = "Name must be at most 255 characters")
        @Pattern(regexp = "^[^\\p{Cntrl}]*$", message = "Name must not contain control characters")
        String name,

        @Schema(
                description = "Space icon assignment. Absent leaves the icon unchanged; "
                        + "a value with a null type clears it.")
        PageIconRequest icon,

        @Schema(description = "Access mode. Absent leaves it unchanged.")
        SpaceAccessMode accessMode,

        @Schema(
                description = "Level every workspace member inherits while PUBLIC. "
                        + "Absent leaves it unchanged; OWNER and NO_ACCESS are rejected.")
        DocumentAccessLevel everyoneAccessLevel) {}
