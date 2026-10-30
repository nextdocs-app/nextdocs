package com.nextdocs.api.space.controller;

import com.nextdocs.api.attachment.dto.response.AttachmentResponse;
import com.nextdocs.api.auth.security.UserPrincipal;
import com.nextdocs.api.common.response.ApiResponse;
import com.nextdocs.api.document.dto.response.DocumentResponse;
import com.nextdocs.api.space.dto.request.SpaceAttachPageRequest;
import com.nextdocs.api.space.dto.request.SpaceCreateRequest;
import com.nextdocs.api.space.dto.request.SpaceMemberAccessUpdateRequest;
import com.nextdocs.api.space.dto.request.SpaceMemberCreateRequest;
import com.nextdocs.api.space.dto.request.SpaceMoveRequest;
import com.nextdocs.api.space.dto.request.SpaceUpdateRequest;
import com.nextdocs.api.space.dto.response.SpaceMemberResponse;
import com.nextdocs.api.space.dto.response.SpaceResponse;
import com.nextdocs.api.space.service.SpaceService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@Tag(name = "Spaces", description = "Space-level permissions: Public and Custom containers of pages")
@RestController
@RequestMapping(SpaceController.BASE_PATH)
@RequiredArgsConstructor
@SecurityRequirement(name = "bearerAuth")
public class SpaceController {

    /** Route shapes, exposed so tests reference the real strings. */
    public static final String BASE_PATH = "/api/v1/spaces";

    public static final String MEMBERS_PATH = BASE_PATH + "/{id}/members";

    public static final String PAGES_PATH = BASE_PATH + "/{id}/pages";

    public static final String MOVE_PATH = BASE_PATH + "/{id}/move";

    public static final String ATTACHMENTS_PATH = BASE_PATH + "/attachments";

    private final SpaceService spaceService;

    @Operation(
            summary = "List spaces",
            description = "Returns the active spaces the caller can see: their memberships, every PUBLIC space, "
                    + "and — for a workspace owner or admin — all spaces of the workspace. "
                    + "With archived=true, returns the archived spaces the caller can administer instead, "
                    + "newest archive first. Each entry carries the caller's effective level, member count, "
                    + "page count, and archivedAt.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Spaces returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Authentication required")
            })
    @GetMapping
    public ResponseEntity<ApiResponse<List<SpaceResponse>>> list(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestParam(required = false, defaultValue = "false") boolean archived) {
        return ResponseEntity.ok(ApiResponse.ok(spaceService.listSpaces(callerId(principal), archived)));
    }

    @Operation(
            summary = "Create a space",
            description = "Creates a space owned by the caller. Defaults to CUSTOM access (only listed members); "
                    + "PUBLIC spaces additionally grant every workspace member `everyoneAccessLevel`. "
                    + "Icons may be an emoji, a builtin icon, an https link, or an uploaded image id "
                    + "from the spaces attachments route.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "201",
                        description = "Space created"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "400",
                        description = "Invalid request payload"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Authentication required")
            })
    @PostMapping
    public ResponseEntity<ApiResponse<SpaceResponse>> create(
            @AuthenticationPrincipal UserPrincipal principal, @Valid @RequestBody SpaceCreateRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(spaceService.createSpace(callerId(principal), request), "Space created."));
    }

    @Operation(
            summary = "Upload a space icon image",
            description = "Stores a raster image a space icon can reference and returns its id. Any "
                    + "workspace member may upload: opening a space is open to members, and an "
                    + "upload no icon adopts is private and swept. Set the returned id through "
                    + "create or update with icon type UPLOAD; the file is never anonymous.",
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
                        description = "Caller is not a member of the workspace"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "413",
                        description = "File exceeds the configured size limit")
            })
    @PostMapping(value = "/attachments", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ApiResponse<AttachmentResponse>> uploadAttachment(
            @AuthenticationPrincipal UserPrincipal principal, @RequestPart("file") MultipartFile file) {
        AttachmentResponse response = spaceService.uploadIconAttachment(callerId(principal), file);
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(response, "Attachment uploaded."));
    }

    @Operation(
            summary = "Get a space",
            description = "Returns one space the caller can read, or any space when the caller is a workspace "
                    + "owner or admin. Other spaces are masked as not found.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Space returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Space not found or not visible to the caller")
            })
    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<SpaceResponse>> get(
            @AuthenticationPrincipal UserPrincipal principal, @PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.ok(spaceService.getSpace(callerId(principal), id)));
    }

    @Operation(
            summary = "Move a space in the caller's sidebar",
            description = "Any caller who can read the space may move it. Space order is personal: only the "
                    + "caller's navigation changes, never the shared space row. prevSiblingId places the space "
                    + "immediately after that neighbour, nextSiblingId immediately before it; both neighbours "
                    + "must be visible, active spaces. An archived space cannot be moved.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Space moved, updated projection returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "400",
                        description = "Invalid sibling reference"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Space or sibling not found or not visible to the caller"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "409",
                        description = "Space is archived or the position changed concurrently")
            })
    @PostMapping("/{id}/move")
    public ResponseEntity<ApiResponse<SpaceResponse>> move(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable UUID id,
            @Valid @RequestBody SpaceMoveRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(spaceService.moveSpace(callerId(principal), id, request)));
    }

    @Operation(
            summary = "Update a space",
            description = "Renames, re-icons, or re-shares a space. Space owner or workspace admin. "
                    + "Absent fields are left unchanged; an icon object with a null type clears the icon.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Space updated"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "400",
                        description = "Invalid request payload"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "403",
                        description = "Caller cannot administer this space"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Space not found")
            })
    @PatchMapping("/{id}")
    public ResponseEntity<ApiResponse<SpaceResponse>> update(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable UUID id,
            @Valid @RequestBody SpaceUpdateRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(spaceService.updateSpace(callerId(principal), id, request)));
    }

    @Operation(
            summary = "Archive a space",
            description = "Space owner or workspace admin. Hides the space from normal navigation and makes "
                    + "it read-only: pages, hierarchy, attachments, memberships, and access rules stay intact. "
                    + "Idempotent. Restore clears the archive.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Space archived"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "403",
                        description = "Caller cannot administer this space"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Space not found")
            })
    @PostMapping("/{id}/archive")
    public ResponseEntity<ApiResponse<SpaceResponse>> archive(
            @AuthenticationPrincipal UserPrincipal principal, @PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.ok(spaceService.archiveSpace(callerId(principal), id)));
    }

    @Operation(
            summary = "Restore an archived space",
            description = "Space owner or workspace admin. Clears the archive so navigation and writes work "
                    + "again; every page, membership, and access rule is exactly as it was. Idempotent.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Space restored"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "403",
                        description = "Caller cannot administer this space"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Space not found")
            })
    @PostMapping("/{id}/restore")
    public ResponseEntity<ApiResponse<SpaceResponse>> restore(
            @AuthenticationPrincipal UserPrincipal principal, @PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.ok(spaceService.restoreSpace(callerId(principal), id)));
    }

    @Operation(
            summary = "Delete a space",
            description = "Space owner or workspace admin. Only an empty space can be deleted: every page, "
                    + "including pages in trash, must be permanently deleted first. Archive the space instead "
                    + "when it still holds pages.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "204",
                        description = "Space deleted"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "403",
                        description = "Caller cannot administer this space"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Space not found"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "409",
                        description = "Space still contains pages, including pages in trash")
            })
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@AuthenticationPrincipal UserPrincipal principal, @PathVariable UUID id) {
        spaceService.deleteSpace(callerId(principal), id);
        return ResponseEntity.noContent().build();
    }

    @Operation(
            summary = "List space members",
            description = "Returns the member roster. Space member or workspace admin; a public-space reader "
                    + "who is not a member cannot enumerate people.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Members returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "403",
                        description = "Space is readable but the caller is not a member or an admin"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Space not found or not visible to the caller")
            })
    @GetMapping("/{id}/members")
    public ResponseEntity<ApiResponse<List<SpaceMemberResponse>>> listMembers(
            @AuthenticationPrincipal UserPrincipal principal, @PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.ok(spaceService.listMembers(callerId(principal), id)));
    }

    @Operation(
            summary = "Add a space member",
            description = "Space owner or workspace admin. The target must already be a workspace member. "
                    + "Returns the recalculated roster, so a client never follows the write with a read.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "201",
                        description = "Member added, roster returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "400",
                        description = "Invalid access level"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "403",
                        description = "Caller cannot administer this space"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Space, user, or workspace membership not found"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "409",
                        description = "That person is already a member")
            })
    @PostMapping("/{id}/members")
    public ResponseEntity<ApiResponse<List<SpaceMemberResponse>>> addMember(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable UUID id,
            @Valid @RequestBody SpaceMemberCreateRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(spaceService.addMember(callerId(principal), id, request), "Member added."));
    }

    @Operation(
            summary = "Change a member's access level",
            description = "Space owner or workspace admin. The last owner cannot be demoted (409); promote "
                    + "another member to owner first. Returns the recalculated roster.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Level updated, roster returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "400",
                        description = "Invalid access level"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "403",
                        description = "Caller cannot administer this space"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Space or member not found"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "409",
                        description = "Last owner would be demoted")
            })
    @PatchMapping("/{id}/members/{userId}")
    public ResponseEntity<ApiResponse<List<SpaceMemberResponse>>> updateMemberAccess(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable UUID id,
            @PathVariable UUID userId,
            @Valid @RequestBody SpaceMemberAccessUpdateRequest request) {
        return ResponseEntity.ok(
                ApiResponse.ok(spaceService.updateMemberAccess(callerId(principal), id, userId, request)));
    }

    @Operation(
            summary = "Remove a space member, or leave the space",
            description = "Space owner or workspace admin; a member may remove themselves. The last owner "
                    + "cannot leave or be removed (409). Returns the recalculated roster.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Member removed, roster returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "403",
                        description = "Caller cannot administer this space"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Space or member not found"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "409",
                        description = "Last owner would be removed")
            })
    @DeleteMapping("/{id}/members/{userId}")
    public ResponseEntity<ApiResponse<List<SpaceMemberResponse>>> removeMember(
            @AuthenticationPrincipal UserPrincipal principal, @PathVariable UUID id, @PathVariable UUID userId) {
        return ResponseEntity.ok(ApiResponse.ok(spaceService.removeMember(callerId(principal), id, userId)));
    }

    @Operation(
            summary = "File a root page into a space",
            description = "Space owner or workspace admin, plus EDIT on the page. Only root pages can be filed; "
                    + "the page's access then flows from the space, with any document-level collaborator or "
                    + "link grant still taking precedence on the page itself.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Page filed, page projection returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "400",
                        description = "Page is not a root page"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "403",
                        description = "Caller cannot administer this space or edit the page"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Space or page not found"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "409",
                        description = "Page already belongs to another space")
            })
    @PostMapping("/{id}/pages")
    public ResponseEntity<ApiResponse<DocumentResponse>> attachPage(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable UUID id,
            @Valid @RequestBody SpaceAttachPageRequest request) {
        return ResponseEntity.ok(
                ApiResponse.ok(spaceService.attachPage(callerId(principal), id, request.documentId())));
    }

    @Operation(
            summary = "Detach a page from its space",
            description = "Space owner or workspace admin, plus EDIT on the page. The page returns to its "
                    + "owner's Private section.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "204",
                        description = "Page detached"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "403",
                        description = "Caller cannot administer this space or edit the page"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Space or page not found in this space")
            })
    @DeleteMapping("/{id}/pages/{documentId}")
    public ResponseEntity<Void> detachPage(
            @AuthenticationPrincipal UserPrincipal principal, @PathVariable UUID id, @PathVariable UUID documentId) {
        spaceService.detachPage(callerId(principal), id, documentId);
        return ResponseEntity.noContent().build();
    }

    private static UUID callerId(UserPrincipal principal) {
        return Objects.requireNonNull(principal, "Authentication is required.").getId();
    }
}
