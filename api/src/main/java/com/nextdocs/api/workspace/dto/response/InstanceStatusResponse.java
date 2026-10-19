package com.nextdocs.api.workspace.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "Public instance status for the auth screens")
public record InstanceStatusResponse(
        @Schema(
                description = "Whether the instance has a workspace member yet; an uninitialized instance"
                        + " registers its first account without an invite")
        boolean initialized) {}
