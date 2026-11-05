package com.nextdocs.api.workspace.controller;

import com.nextdocs.api.auth.security.UserPrincipal;
import com.nextdocs.api.common.response.ApiResponse;
import com.nextdocs.api.workspace.dto.request.WorkspaceGroupRequest;
import com.nextdocs.api.workspace.dto.response.WorkspaceGroupResponse;
import com.nextdocs.api.workspace.service.WorkspaceGroupService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
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

@Tag(name = "Workspace groups", description = "Flat groups used as page-grant principals")
@RestController
@RequestMapping(WorkspaceController.CURRENT_PATH + "/groups")
@RequiredArgsConstructor
@SecurityRequirement(name = "bearerAuth")
public class WorkspaceGroupController {

    private final WorkspaceGroupService groupService;

    @Operation(summary = "List workspace groups", description = "Any workspace member.")
    @GetMapping
    public ResponseEntity<ApiResponse<List<WorkspaceGroupResponse>>> list(
            @AuthenticationPrincipal UserPrincipal principal) {
        return ResponseEntity.ok(ApiResponse.ok(groupService.list(callerId(principal))));
    }

    @Operation(summary = "Create a group", description = "Owner or admin.")
    @PostMapping
    public ResponseEntity<ApiResponse<WorkspaceGroupResponse>> create(
            @AuthenticationPrincipal UserPrincipal principal, @Valid @RequestBody WorkspaceGroupRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(groupService.create(callerId(principal), request)));
    }

    @Operation(summary = "Replace a group and its members", description = "Owner or admin.")
    @PatchMapping("/{groupId}")
    public ResponseEntity<ApiResponse<WorkspaceGroupResponse>> update(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable UUID groupId,
            @Valid @RequestBody WorkspaceGroupRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(groupService.update(callerId(principal), groupId, request)));
    }

    @Operation(summary = "Delete a group", description = "Owner or admin.")
    @DeleteMapping("/{groupId}")
    public ResponseEntity<Void> delete(@AuthenticationPrincipal UserPrincipal principal, @PathVariable UUID groupId) {
        groupService.delete(callerId(principal), groupId);
        return ResponseEntity.noContent().build();
    }

    private static UUID callerId(UserPrincipal principal) {
        return Objects.requireNonNull(principal, "Authentication is required.").getId();
    }
}
