package com.nextdocs.api.auth.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

@Schema(description = "Request body for previewing an invitation link; the token never travels in the URL")
public record InvitePreviewRequest(
        @Schema(description = "Token from the invitation link's URL fragment")
        @NotBlank(message = "Invitation token is required")
        @Size(max = 255, message = "Invitation token is too long")
        String token) {

    @Override
    public String toString() {
        return "InvitePreviewRequest[token=[PROTECTED]]";
    }
}
