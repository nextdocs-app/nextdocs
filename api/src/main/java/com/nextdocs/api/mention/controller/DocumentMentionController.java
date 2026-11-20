package com.nextdocs.api.mention.controller;

import com.nextdocs.api.common.response.ApiResponse;
import com.nextdocs.api.mention.dto.response.MentionCandidateResponse;
import com.nextdocs.api.mention.service.MentionCandidateService;
import com.nextdocs.api.security.UserPrincipal;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The mention picker. Authenticated only: a share-link guest has no stable identity to
 * notify, so the web client hides the `@` menu for guests instead of offering people
 * who cannot be reached.
 */
@Tag(name = "Mentions", description = "Mention candidates for a document")
@RestController
@RequestMapping("/api/v1/documents")
@RequiredArgsConstructor
@SecurityRequirement(name = "bearerAuth")
public class DocumentMentionController {

    private final MentionCandidateService candidateService;

    @Operation(
            summary = "Search people who can be mentioned in a document",
            description = "Returns workspace members who currently have effective access to the "
                    + "document and match the optional name/email query. The caller needs COMMENT "
                    + "access, which both the document editor and the comment composer already require, "
                    + "plus an identity grant: a caller admitted only by a share link may comment but "
                    + "must not enumerate the workspace roster.")
    @GetMapping("/{documentId}/mentionable-users")
    public ResponseEntity<ApiResponse<List<MentionCandidateResponse>>> mentionableUsers(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable UUID documentId,
            @RequestParam(value = "q", required = false) String query,
            @RequestParam(value = "limit", required = false, defaultValue = "20") int limit) {
        UUID callerId =
                Objects.requireNonNull(principal, "Authentication is required.").getId();
        return ResponseEntity.ok(ApiResponse.ok(candidateService.search(callerId, documentId, query, limit)));
    }
}
