package com.nextdocs.api.workspace.controller;

import com.nextdocs.api.attachment.dto.response.AttachmentResponse;
import com.nextdocs.api.auth.security.UserPrincipal;
import com.nextdocs.api.common.response.ApiResponse;
import com.nextdocs.api.common.response.PagedResponse;
import com.nextdocs.api.workspace.dto.request.WorkspaceInviteCreateRequest;
import com.nextdocs.api.workspace.dto.request.WorkspaceMemberRoleUpdateRequest;
import com.nextdocs.api.workspace.dto.request.WorkspaceUpdateRequest;
import com.nextdocs.api.workspace.dto.response.WorkspaceInviteCreatedResponse;
import com.nextdocs.api.workspace.dto.response.WorkspaceInviteEmailResult;
import com.nextdocs.api.workspace.dto.response.WorkspaceInviteResponse;
import com.nextdocs.api.workspace.dto.response.WorkspaceMemberResponse;
import com.nextdocs.api.workspace.dto.response.WorkspaceResponse;
import com.nextdocs.api.workspace.service.WorkspaceInviteService;
import com.nextdocs.api.workspace.service.WorkspaceService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@Tag(name = "Workspace", description = "Workspace identity and membership administration")
@RestController
@RequestMapping(WorkspaceController.CURRENT_PATH)
@RequiredArgsConstructor
@SecurityRequirement(name = "bearerAuth")
public class WorkspaceController {

    /** Route shapes, exposed so tests reference the real strings. */
    public static final String CURRENT_PATH = "/api/v1/workspaces/current";

    public static final String MEMBERS_PATH = CURRENT_PATH + "/members";

    public static final String ATTACHMENTS_PATH = CURRENT_PATH + "/attachments";

    public static final String INVITES_PATH = CURRENT_PATH + "/invites";

    private final WorkspaceService workspaceService;

    private final WorkspaceInviteService inviteService;

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
            description = "Owner only. An owner may change their own role: promote another member to "
                    + "owner first, then step down. The last owner cannot demote themselves. Returns "
                    + "the recalculated roster.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Role updated, member roster returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "400",
                        description = "Invalid role"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "403",
                        description = "Caller is not an owner"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Member not found"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "409",
                        description = "Last owner cannot demote themselves")
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

    @Operation(
            summary = "Upload a workspace icon image",
            description = "Stores an image for use as the workspace icon and returns its id. Owner only. "
                    + "Set the returned id through PATCH on the workspace with icon type UPLOAD.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "201",
                        description = "Attachment stored"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "400",
                        description = "Empty or invalid file"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Authentication required"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "403",
                        description = "Caller is not an owner"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "413",
                        description = "File exceeds the configured size limit")
            })
    @PostMapping(value = "/attachments", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ApiResponse<AttachmentResponse>> uploadAttachment(
            @AuthenticationPrincipal UserPrincipal principal, @RequestPart("file") MultipartFile file) {
        AttachmentResponse response = workspaceService.uploadAttachment(callerId(principal), file);
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(response, "Attachment uploaded."));
    }

    @Operation(
            summary = "Invite people to the workspace",
            description = "Owner or admin. Creates one invite per distinct email, emails the signup link "
                    + "to each invited address, and returns a per-email result. The link is never returned: "
                    + "it exists only in the email, so accepting it proves the invited mailbox. Owners can "
                    + "invite any role, admins only plain members. Re-inviting a pending email replaces its "
                    + "invite (role and expiry).",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "201",
                        description = "Invites processed, per-email results returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "400",
                        description = "Validation error"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "403",
                        description = "Caller is not an admin, or issued a role they cannot grant"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "503",
                        description = "This instance has no email delivery configured, so invites cannot be sent")
            })
    @PostMapping("/invites")
    public ResponseEntity<ApiResponse<List<WorkspaceInviteEmailResult>>> createInvites(
            @AuthenticationPrincipal UserPrincipal principal,
            @Valid @RequestBody WorkspaceInviteCreateRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(inviteService.createInvites(callerId(principal), request), "Invites processed."));
    }

    @Operation(
            summary = "List pending invites",
            description = "Owner or admin. Accepted and revoked invites are not listed. "
                    + "Paginated so an instance that issued many invites does not return them all in one response.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Pending invites returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "403",
                        description = "Caller is not an admin")
            })
    @GetMapping("/invites")
    public ResponseEntity<ApiResponse<PagedResponse<WorkspaceInviteResponse>>> listInvites(
            @AuthenticationPrincipal UserPrincipal principal,
            @PageableDefault(size = 20, sort = "createdAt") Pageable pageable) {
        return ResponseEntity.ok(
                ApiResponse.ok(PagedResponse.from(inviteService.listInvites(callerId(principal), pageable))));
    }

    @Operation(
            summary = "Revoke an invite",
            description = "Owner or admin. Deletes the invite: the address can no longer register with "
                    + "it. Admins may only manage member invites.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "204",
                        description = "Invite revoked"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "403",
                        description = "Caller is not an admin, or cannot grant the invite's role"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Invite not found or already accepted")
            })
    @DeleteMapping("/invites/{inviteId}")
    public ResponseEntity<Void> revokeInvite(
            @AuthenticationPrincipal UserPrincipal principal, @PathVariable UUID inviteId) {
        inviteService.revoke(callerId(principal), inviteId);
        return ResponseEntity.noContent().build();
    }

    @Operation(
            summary = "Resend an invite",
            description = "Owner or admin. Rotates the invite's token and resets its expiry — the previous "
                    + "link stops working — and emails the fresh link to the invited address (never to the "
                    + "caller). Admins may only manage member invites.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Invite rotated and emailed"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "403",
                        description = "Caller is not an admin, or cannot grant the invite's role"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Invite not found or already accepted"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "503",
                        description = "This instance has no email delivery configured, so the invite was not rotated")
            })
    @PostMapping("/invites/{inviteId}/resend")
    public ResponseEntity<ApiResponse<WorkspaceInviteCreatedResponse>> resendInvite(
            @AuthenticationPrincipal UserPrincipal principal, @PathVariable UUID inviteId) {
        return ResponseEntity.ok(
                ApiResponse.ok(inviteService.resend(callerId(principal), inviteId), "Invitation resent."));
    }

    private static UUID callerId(UserPrincipal principal) {
        return Objects.requireNonNull(principal, "Authentication is required.").getId();
    }
}
