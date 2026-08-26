package com.nextdocs.api.document.controller;

import com.nextdocs.api.auth.security.UserPrincipal;
import com.nextdocs.api.common.response.ApiResponse;
import com.nextdocs.api.common.response.PagedResponse;
import com.nextdocs.api.document.dto.request.DocumentCreateRequest;
import com.nextdocs.api.document.dto.request.DocumentMoveRequest;
import com.nextdocs.api.document.dto.request.DocumentUpdateRequest;
import com.nextdocs.api.document.dto.response.DocumentBreadcrumbResponse;
import com.nextdocs.api.document.dto.response.DocumentResponse;
import com.nextdocs.api.document.service.DocumentService;
import com.nextdocs.api.document.service.DocumentTreeService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
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
import org.springframework.web.bind.annotation.*;

@Tag(name = "Documents", description = "Document persistence endpoints")
@RestController
@RequestMapping("/api/v1/documents")
@RequiredArgsConstructor
@SecurityRequirement(name = "bearerAuth")
public class DocumentController {

    private final DocumentService documentService;
    private final DocumentTreeService documentTreeService;

    @Operation(
            summary = "Create a document",
            description = "Creates a new document owned by the authenticated user.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Document already existed for the authenticated user"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "201",
                        description = "Document created"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "400",
                        description = "Invalid request payload"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Authentication required")
            })
    @PostMapping
    public ResponseEntity<ApiResponse<DocumentResponse>> create(
            @AuthenticationPrincipal UserPrincipal principal, @Valid @RequestBody DocumentCreateRequest request) {
        DocumentService.CreateDocumentResult result = documentService.create(principal.getId(), request);
        HttpStatus status = result.created() ? HttpStatus.CREATED : HttpStatus.OK;
        String message = result.created() ? "Document created." : "Document already exists.";
        return ResponseEntity.status(status).body(ApiResponse.ok(result.document(), message));
    }

    @Operation(
            summary = "List documents",
            description = "Returns a paged list of documents filtered by parentId, scope, and trashed. "
                    + "Use parentId=root for root-level documents, or parentId=<UUID> for direct children. "
                    + "Use scope=private for unshared owned documents, scope=shared for shared documents, "
                    + "or scope=all for all owned documents. Use trashed=true for trash.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Documents returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "400",
                        description = "Invalid filter parameters"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Authentication required")
            })
    @GetMapping
    public ResponseEntity<ApiResponse<PagedResponse<DocumentResponse>>> list(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestParam(required = false) String parentId,
            @RequestParam(required = false, defaultValue = "all") String scope,
            @RequestParam(required = false) Boolean trashed,
            @PageableDefault(size = 20) Pageable pageable) {
        Page<DocumentResponse> page = documentService.list(principal.getId(), parentId, scope, trashed, pageable);
        return ResponseEntity.ok(ApiResponse.ok(PagedResponse.from(page)));
    }

    @Operation(
            summary = "Get a single document",
            description = "Returns one document the authenticated user can access. "
                    + "Trashed documents are omitted by default (404) so realtime access checks stay strict. "
                    + "Pass includeTrashed=true to load a trashed document (e.g. trash UI or restore); trashed "
                    + "documents are visible to their owner and collaborators with at least EDIT access.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Document returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Authentication required"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Document not found")
            })
    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<DocumentResponse>> get(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable UUID id,
            @RequestParam(required = false, defaultValue = "false") boolean includeTrashed) {
        return ResponseEntity.ok(ApiResponse.ok(documentService.get(principal.getId(), id, includeTrashed)));
    }

    @Operation(
            summary = "Get a document publicly (general access)",
            description =
                    "Returns a document if its general access mode is ANYONE_WITH_LINK. No authentication required.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Public document returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Document not found or not shared as ANYONE_WITH_LINK")
            })
    @SecurityRequirements({})
    @GetMapping("/{id}/public")
    public ResponseEntity<ApiResponse<DocumentResponse>> getPublic(@PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.ok(documentService.getPublic(id)));
    }

    @Operation(
            summary = "Get document breadcrumbs hierarchy",
            description = "Returns the ancestor hierarchy path from the root document down to the specified document.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Hierarchy path returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Authentication required"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Document not found")
            })
    @GetMapping("/{id}/path")
    public ResponseEntity<ApiResponse<List<DocumentBreadcrumbResponse>>> getBreadcrumbs(
            @AuthenticationPrincipal UserPrincipal principal, @PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.ok(documentService.getBreadcrumbs(principal.getId(), id)));
    }

    @Operation(
            summary = "Get public document breadcrumbs hierarchy",
            description = "Returns the ancestor hierarchy path for a publicly accessible document.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Public hierarchy path returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Document not found or not shared publicly")
            })
    @SecurityRequirements({})
    @GetMapping("/{id}/public/path")
    public ResponseEntity<ApiResponse<List<DocumentBreadcrumbResponse>>> getPublicBreadcrumbs(@PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.ok(documentService.getPublicBreadcrumbs(id)));
    }

    @Operation(
            summary = "Update a document",
            description = "Updates metadata and/or Yjs state for an active document owned by the authenticated user. "
                    + "Documents in trash cannot be updated.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Document updated"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "400",
                        description = "Invalid request payload"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Authentication required"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Document not found"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "409",
                        description = "Document is in trash")
            })
    @PatchMapping("/{id}")
    public ResponseEntity<ApiResponse<DocumentResponse>> update(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable UUID id,
            @Valid @RequestBody DocumentUpdateRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(documentService.update(principal.getId(), id, request)));
    }

    @Operation(
            summary = "Move a document to trash or delete permanently",
            description = "By default moves the document to trash (soft delete). Requires EDIT access. "
                    + "Use permanent=true to permanently delete a document that is already in trash; "
                    + "permanently deleting also requires EDIT access and verifies the explicit resource ID "
                    + "against the caller's permission chain.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "204",
                        description = "Document deleted or moved to trash"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "400",
                        description = "Invalid request (e.g. permanent delete while not in trash)"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Authentication required"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Document not found")
            })
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable UUID id,
            @RequestParam(required = false, defaultValue = "false") boolean permanent) {
        documentService.delete(principal.getId(), id, permanent);
        return ResponseEntity.noContent().build();
    }

    @Operation(
            summary = "Restore a document from trash",
            description = "Clears trash state for a document. Requires EDIT access in the trash scope: "
                    + "the owner and EDIT collaborators of the trashed document (or its nearest untrashed "
                    + "ancestor chain) may restore it.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Document restored"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Authentication required"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Document not found or not in trash")
            })
    @PostMapping("/{id}/restore")
    public ResponseEntity<ApiResponse<DocumentResponse>> restore(
            @AuthenticationPrincipal UserPrincipal principal, @PathVariable UUID id) {
        DocumentResponse response = documentService.restore(principal.getId(), id);
        return ResponseEntity.ok(ApiResponse.ok(response, "Document restored."));
    }

    @Operation(
            summary = "Move a document to a new parent / position",
            description =
                    "Relocates a document within the tree by updating its parent or personal navigation order. "
                            + "When newParentId is present the caller must have EDIT access to both the document and the target parent "
                            + "(owner or collaborator via ancestor sharing). "
                            + "When newParentId is null the document is reordered in the caller's root navigation: owners may un-parent their own documents, "
                            + "while collaborators with at least VIEW access may reorder a shared root document in their personal Shared section.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Document moved"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "400",
                        description = "Cycle detected or invalid sibling references"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Authentication required"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "403",
                        description = "Caller lacks required access"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Document or sibling not found")
            })
    @PostMapping("/{id}/move")
    public ResponseEntity<ApiResponse<DocumentResponse>> move(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable UUID id,
            @Valid @RequestBody DocumentMoveRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(documentTreeService.move(principal.getId(), id, request)));
    }
}
