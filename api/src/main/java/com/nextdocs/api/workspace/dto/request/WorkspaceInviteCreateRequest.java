package com.nextdocs.api.workspace.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import java.util.List;

@Schema(description = "Request body for creating invites, one per email")
public record WorkspaceInviteCreateRequest(
        @Schema(
                description = "Email addresses to invite; duplicates are collapsed and each entry gets its own result",
                example = "[\"jane@example.com\", \"john@example.com\"]")
        @NotEmpty(message = "At least one email is required")
        @Size(max = MAX_EMAILS_PER_REQUEST, message = "At most {max} addresses can be invited in one request")
        List<String> emails,

        @Schema(description = "Role for the invited accounts", example = "MEMBER")
        @NotBlank(message = "Role is required")
        String role) {

    /**
     * Each address costs a row and its own synchronous delivery attempt on the request
     * thread, so a request is one page of invites; a larger set is invited in several
     * requests.
     */
    public static final int MAX_EMAILS_PER_REQUEST = 20;
}
