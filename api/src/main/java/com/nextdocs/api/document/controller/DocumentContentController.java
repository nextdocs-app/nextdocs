package com.nextdocs.api.document.controller;

import com.nextdocs.api.auth.security.UserPrincipal;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.common.response.ApiResponse;
import com.nextdocs.api.document.dto.response.DocumentAccessResponse;
import com.nextdocs.api.document.dto.response.DocumentContentResponse;
import com.nextdocs.api.document.service.DocumentSharingService;
import com.nextdocs.api.realtime.service.DocumentContentService;
import com.nextdocs.api.workspace.service.WorkspaceAccessService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import io.swagger.v3.oas.annotations.tags.Tag;
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
 * First-paint content reads. Metadata lives in {@code DocumentController}; these
 * routes only proxy Yhub's authoritative document body, so the browser never needs a
 * second copy in Postgres.
 */
@Tag(name = "Document Content", description = "On-demand document content reads from Yhub")
@RestController
@RequestMapping("/api/v1/documents")
@RequiredArgsConstructor
@SecurityRequirement(name = "bearerAuth")
public class DocumentContentController {

    private final DocumentContentService contentService;
    private final DocumentSharingService sharingService;
    private final WorkspaceAccessService workspaceAccessService;

    @Operation(
            summary = "Get a document's content",
            description = "Reads the document body from Yhub. Pass includeTrashed=true to read the "
                    + "body of a trashed document the caller can still see in the trash view.")
    @GetMapping("/{id}/content")
    public ResponseEntity<ApiResponse<DocumentContentResponse>> get(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable UUID id,
            @RequestParam(required = false, defaultValue = "false") boolean includeTrashed) {

        // Membership is the outer gate, matching the realtime access endpoint: a user
        // removed from the workspace must not keep reading through pages they still own.
        workspaceAccessService.requireMember(principal.getId());
        DocumentAccessResponse access = sharingService.getMyAccess(principal.getId(), id);
        if (!access.allowed() || access.accessLevel() == null || (!includeTrashed && access.trashed())) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }

        return ResponseEntity.ok(ApiResponse.ok(contentService.read(id)));
    }

    @Operation(
            summary = "Get a public document's content",
            description = "Reads the body of a document whose effective share-link access allows this "
                    + "caller. No authentication required.")
    @SecurityRequirements({})
    @GetMapping("/{id}/public/content")
    public ResponseEntity<ApiResponse<DocumentContentResponse>> getPublic(@PathVariable UUID id) {
        DocumentAccessResponse access = sharingService.accessCheckPublic(id);
        if (!access.allowed() || access.accessLevel() == null) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }

        return ResponseEntity.ok(ApiResponse.ok(contentService.read(id)));
    }
}
