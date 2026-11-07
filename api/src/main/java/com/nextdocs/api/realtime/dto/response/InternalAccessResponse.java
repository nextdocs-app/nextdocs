package com.nextdocs.api.realtime.dto.response;

import com.nextdocs.api.document.entity.DocumentAccessLevel;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;

@Schema(description = "Internal access check verdict for Yhub auth plugin")
public record InternalAccessResponse(
        @Schema(description = "Identified user ID, or null for guest")
        UUID userId,

        @Schema(description = "Resolved access level") DocumentAccessLevel accessLevel,

        @Schema(description = "Whether document is currently in trash")
        boolean trashed,

        @Schema(description = "Whether access is granted") boolean allowed) {

    public static InternalAccessResponse denied(boolean trashed) {
        return new InternalAccessResponse(null, null, trashed, false);
    }
}
