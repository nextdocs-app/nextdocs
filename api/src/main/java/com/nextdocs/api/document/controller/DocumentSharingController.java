package com.nextdocs.api.document.controller;

import com.nextdocs.api.auth.security.UserPrincipal;
import com.nextdocs.api.common.response.ApiResponse;
import com.nextdocs.api.common.response.PagedResponse;
import com.nextdocs.api.document.dto.request.CollaboratorAccessUpdateRequest;
import com.nextdocs.api.document.dto.request.CollaboratorUpsertRequest;
import com.nextdocs.api.document.dto.request.SharingSettingsUpdateRequest;
import com.nextdocs.api.document.dto.response.CollaboratorResponse;
import com.nextdocs.api.document.dto.response.DocumentAccessResponse;
import com.nextdocs.api.document.dto.response.DocumentResponse;
import com.nextdocs.api.document.dto.response.SharingSettingsResponse;
import com.nextdocs.api.document.service.DocumentSharingService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "Document Sharing", description = "Document collaboration and sharing endpoints")
@RestController
@RequestMapping("/api/v1/documents")
@RequiredArgsConstructor
@SecurityRequirement(name = "bearerAuth")
public class DocumentSharingController {

    private final DocumentSharingService sharingService;

    @Operation(
            summary = "List document collaborators",
            description = "Returns the owner and all collaborators for the specified document.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Collaborators returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Authentication required"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Document not found")
            })
    @GetMapping("/{id}/collaborators")
    public ResponseEntity<ApiResponse<List<CollaboratorResponse>>> listCollaborators(
            @AuthenticationPrincipal UserPrincipal principal, @PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.ok(sharingService.listCollaborators(principal.getId(), id)));
    }

    @Operation(
            summary = "Add or update a collaborator",
            description = "Creates or updates collaborator access for the specified document by email.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "201",
                        description = "Collaborator saved"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "400",
                        description = "Invalid request payload"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Authentication required"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Document or user not found")
            })
    @PostMapping("/{id}/collaborators")
    public ResponseEntity<ApiResponse<CollaboratorResponse>> upsertCollaborator(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable UUID id,
            @Valid @RequestBody CollaboratorUpsertRequest request) {
        CollaboratorResponse response = sharingService.upsertCollaborator(principal.getId(), id, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(response, "Collaborator saved."));
    }

    @Operation(
            summary = "Update collaborator access level",
            description = "Updates an existing collaborator's access level for the specified document.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Collaborator access updated"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "400",
                        description = "Invalid request payload"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Authentication required"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Document or collaborator not found")
            })
    @PatchMapping("/{id}/collaborators/{userId}")
    public ResponseEntity<ApiResponse<CollaboratorResponse>> updateCollaboratorAccess(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable UUID id,
            @PathVariable UUID userId,
            @Valid @RequestBody CollaboratorAccessUpdateRequest request) {
        return ResponseEntity.ok(
                ApiResponse.ok(sharingService.updateCollaboratorAccess(principal.getId(), id, userId, request)));
    }

    @Operation(
            summary = "Remove a collaborator",
            description = "Removes collaborator access from the specified document.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "204",
                        description = "Collaborator removed"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Authentication required"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Document or collaborator not found")
            })
    @DeleteMapping("/{id}/collaborators/{userId}")
    public ResponseEntity<Void> removeCollaborator(
            @AuthenticationPrincipal UserPrincipal principal, @PathVariable UUID id, @PathVariable UUID userId) {
        sharingService.removeCollaborator(principal.getId(), id, userId);
        return ResponseEntity.noContent().build();
    }

    @Operation(
            summary = "Leave a shared document",
            description = "Removes the authenticated user from the collaborator list of the specified shared document.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "204",
                        description = "Left shared document"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Authentication required"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Document or collaborator entry not found")
            })
    @DeleteMapping("/{id}/collaborators/me")
    public ResponseEntity<Void> leaveSharedDocument(
            @AuthenticationPrincipal UserPrincipal principal, @PathVariable UUID id) {
        sharingService.leaveSharedDocument(principal.getId(), id);
        return ResponseEntity.noContent().build();
    }

    @Operation(
            summary = "Get sharing settings",
            description = "Returns general access and link permissions for the specified document.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Sharing settings returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Authentication required"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Document not found")
            })
    @GetMapping("/{id}/sharing")
    public ResponseEntity<ApiResponse<SharingSettingsResponse>> getSharingSettings(
            @AuthenticationPrincipal UserPrincipal principal, @PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.ok(sharingService.getSharingSettings(principal.getId(), id)));
    }

    @Operation(
            summary = "Update sharing settings",
            description = "Updates general access mode and link access level for the specified document.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Sharing settings updated"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "400",
                        description = "Invalid request payload"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Authentication required"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Document not found")
            })
    @PatchMapping("/{id}/sharing")
    public ResponseEntity<ApiResponse<SharingSettingsResponse>> updateSharingSettings(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable UUID id,
            @Valid @RequestBody SharingSettingsUpdateRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(sharingService.updateSharingSettings(principal.getId(), id, request)));
    }

    @Operation(
            summary = "List documents shared with me",
            description = "Returns a paged list of active documents shared with the authenticated user.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Shared documents returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Authentication required")
            })
    @GetMapping("/shared-with-me")
    public ResponseEntity<ApiResponse<PagedResponse<DocumentResponse>>> listSharedWithMe(
            @AuthenticationPrincipal UserPrincipal principal, @PageableDefault(size = 20) Pageable pageable) {
        Page<DocumentResponse> page = sharingService.listSharedWithMe(principal.getId(), pageable);
        return ResponseEntity.ok(ApiResponse.ok(PagedResponse.from(page)));
    }

    @Operation(
            summary = "Get my effective access",
            description = "Returns the authenticated user's effective access level for the specified document.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Access returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Authentication required")
            })
    @GetMapping("/{id}/my-access")
    public ResponseEntity<ApiResponse<DocumentAccessResponse>> myAccess(
            @AuthenticationPrincipal UserPrincipal principal, @PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.ok(sharingService.getMyAccess(principal.getId(), id)));
    }

    @Operation(
            summary = "Check effective access",
            description = "Returns whether the authenticated user can access the specified document and at what level.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Access check returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Authentication required")
            })
    @GetMapping("/{id}/access-check")
    public ResponseEntity<ApiResponse<DocumentAccessResponse>> accessCheck(
            @AuthenticationPrincipal UserPrincipal principal, @PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.ok(sharingService.accessCheck(principal.getId(), id)));
    }
}
