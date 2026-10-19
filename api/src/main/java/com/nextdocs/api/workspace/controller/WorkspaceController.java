package com.nextdocs.api.workspace.controller;

import com.nextdocs.api.auth.security.UserPrincipal;
import com.nextdocs.api.common.response.ApiResponse;
import com.nextdocs.api.workspace.dto.request.WorkspaceMemberRoleUpdateRequest;
import com.nextdocs.api.workspace.dto.request.WorkspaceUpdateRequest;
import com.nextdocs.api.workspace.dto.response.WorkspaceMemberResponse;
import com.nextdocs.api.workspace.dto.response.WorkspaceResponse;
import com.nextdocs.api.workspace.service.WorkspaceService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "Workspace", description = "Workspace identity and membership administration")
@RestController
@RequestMapping(WorkspaceController.CURRENT_PATH)
@RequiredArgsConstructor
@SecurityRequirement(name = "bearerAuth")
public class WorkspaceController {

    /** Route shapes, exposed so tests reference the real strings. */
    public static final String CURRENT_PATH = "/api/v1/workspaces/current";

    public static final String MEMBERS_PATH = CURRENT_PATH + "/members";

    private final WorkspaceService workspaceService;

    @Operation(
            summary = "Get the current workspace",
            description = "Returns the workspace identity and the caller's role. Any member.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Workspace returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Authentication required"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "No workspace membership")
            })
    @GetMapping
    public ResponseEntity<ApiResponse<WorkspaceResponse>> getCurrent(@AuthenticationPrincipal UserPrincipal principal) {
        return ResponseEntity.ok(ApiResponse.ok(workspaceService.getCurrent(callerId(principal))));
    }

    @Operation(
            summary = "Update the current workspace",
            description = "Renames the workspace and/or sets its icon. Owner only. Absent fields are left "
                    + "unchanged; an icon object with a null type clears the icon.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Workspace updated"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "400",
                        description = "Invalid request payload"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "403",
                        description = "Caller is not an owner")
            })
    @PatchMapping
    public ResponseEntity<ApiResponse<WorkspaceResponse>> updateCurrent(
            @AuthenticationPrincipal UserPrincipal principal, @Valid @RequestBody WorkspaceUpdateRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(workspaceService.updateCurrent(callerId(principal), request)));
    }

    @Operation(
            summary = "List workspace members",
            description = "Returns the member roster with roles. Any member.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Members returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Authentication required")
            })
    @GetMapping("/members")
    public ResponseEntity<ApiResponse<List<WorkspaceMemberResponse>>> listMembers(
            @AuthenticationPrincipal UserPrincipal principal) {
        return ResponseEntity.ok(ApiResponse.ok(workspaceService.listMembers(callerId(principal))));
    }

    @Operation(
            summary = "Change a member's role",
            description = "Owner only. The caller cannot change their own role, and the last owner "
                    + "can never be demoted. Returns the recalculated roster.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Role updated, member roster returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "400",
                        description = "Invalid role or self role change"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "403",
                        description = "Caller is not an owner"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Member not found"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "409",
                        description = "Last owner would be demoted")
            })
    @PatchMapping("/members/{userId}")
    public ResponseEntity<ApiResponse<List<WorkspaceMemberResponse>>> updateMemberRole(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable UUID userId,
            @Valid @RequestBody WorkspaceMemberRoleUpdateRequest request) {
        return ResponseEntity.ok(
                ApiResponse.ok(workspaceService.updateMemberRole(callerId(principal), userId, request)));
    }

    @Operation(
            summary = "Remove a member",
            description = "Owner or admin. Admins can remove plain members only; nobody can remove "
                    + "themselves; the last owner can never be removed. Removal deactivates the "
                    + "account and revokes its sessions. Returns the recalculated roster.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Member removed, member roster returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "400",
                        description = "Self-removal"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "403",
                        description = "Admin removing a privileged member"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Member not found"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "409",
                        description = "Last owner would be removed")
            })
    @DeleteMapping("/members/{userId}")
    public ResponseEntity<ApiResponse<List<WorkspaceMemberResponse>>> removeMember(
            @AuthenticationPrincipal UserPrincipal principal, @PathVariable UUID userId) {
        return ResponseEntity.ok(ApiResponse.ok(workspaceService.removeMember(callerId(principal), userId)));
    }

    private static UUID callerId(UserPrincipal principal) {
        return Objects.requireNonNull(principal, "Authentication is required.").getId();
    }
}
