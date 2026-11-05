package com.nextdocs.api.workspace.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;

@Schema(description = "Create or replace a flat workspace group")
public record WorkspaceGroupRequest(
        @NotBlank(message = "Group name is required")
        @Size(max = 255, message = "Group name must be at most 255 characters")
        String name,

        @NotNull(message = "memberIds is required") List<UUID> memberIds) {}
