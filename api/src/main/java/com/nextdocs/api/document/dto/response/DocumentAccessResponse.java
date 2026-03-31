package com.nextdocs.api.document.dto.response;

import com.nextdocs.api.document.entity.DocumentAccessLevel;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;

@Schema(description = "Effective access for a specific document")
public record DocumentAccessResponse(
        @Schema(description = "Document ID") UUID documentId,
        @Schema(description = "Whether access is granted") boolean allowed,
        @Schema(description = "Effective access level") DocumentAccessLevel accessLevel,

        @Schema(description = "Whether current user is owner")
        boolean owner) {}
