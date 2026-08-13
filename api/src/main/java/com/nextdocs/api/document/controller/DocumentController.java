package com.nextdocs.api.document.controller;

import com.nextdocs.api.auth.security.UserPrincipal;
import com.nextdocs.api.common.response.ApiResponse;
import com.nextdocs.api.common.response.PagedResponse;
import com.nextdocs.api.document.dto.request.DocumentCreateRequest;
import com.nextdocs.api.document.dto.request.DocumentMoveRequest;
import com.nextdocs.api.document.dto.request.DocumentUpdateRequest;
import com.nextdocs.api.document.dto.response.DocumentResponse;
import com.nextdocs.api.document.dto.response.DocumentTreeNodeResponse;
import com.nextdocs.api.document.service.DocumentService;
import com.nextdocs.api.document.service.DocumentTreeService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
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
            summary = "List current user's documents",
            description = "Returns a paged list of documents. By default only active documents owned by "
                    + "the authenticated user are returned (ordered by last update). Use trashed=true to list "
                    + "documents in trash (ordered by time moved to trash): those the user owns plus shared "
                    + "documents on which they have at least EDIT access.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Documents returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Authentication required")
            })
    @GetMapping
    public ResponseEntity<ApiResponse<PagedResponse<DocumentResponse>>> list(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestParam(required = false) Boolean trashed,
            @PageableDefault(size = 20) Pageable pageable) {
        boolean trashedOnly = Boolean.TRUE.equals(trashed);
        Page<DocumentResponse> page = documentService.list(principal.getId(), pageable, trashedOnly);
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
            summary = "List root-level documents for the sidebar (paginated)",
            description = "Returns root-level (no parent) non-trashed documents owned by "
                    + "the authenticated user, ordered by order_key. Paginated.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Root documents returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Authentication required")
            })
    @GetMapping("/tree/root")
    public ResponseEntity<ApiResponse<PagedResponse<DocumentTreeNodeResponse>>> getRootDocuments(
            @AuthenticationPrincipal UserPrincipal principal, @PageableDefault(size = 50) Pageable pageable) {
        return ResponseEntity.ok(
                ApiResponse.ok(PagedResponse.from(documentTreeService.getRootDocuments(principal.getId(), pageable))));
    }

    @Operation(
            summary = "List shared documents for the sidebar (paginated)",
            description = "Returns root-level documents in the authenticated user's Shared section "
                    + "(both owner-shared and shared-with-me), ordered by personal order_key. Paginated.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Shared documents returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Authentication required")
            })
    @GetMapping("/tree/shared")
    public ResponseEntity<ApiResponse<PagedResponse<DocumentTreeNodeResponse>>> getSharedDocuments(
            @AuthenticationPrincipal UserPrincipal principal, @PageableDefault(size = 50) Pageable pageable) {
        return ResponseEntity.ok(ApiResponse.ok(
                PagedResponse.from(documentTreeService.getSharedDocuments(principal.getId(), pageable))));
    }

    @Operation(
            summary = "List direct children of a document (paginated)",
            description = "Returns the direct non-trashed children of the given document, "
                    + "ordered by order_key. Paginated. The authenticated user must be the owner "
                    + "or have at least VIEW access.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Children returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Authentication required"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Parent document not found")
            })
    @GetMapping("/{id}/children")
    public ResponseEntity<ApiResponse<PagedResponse<DocumentTreeNodeResponse>>> getChildren(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable UUID id,
            @PageableDefault(size = 50) Pageable pageable) {
        return ResponseEntity.ok(
                ApiResponse.ok(PagedResponse.from(documentTreeService.getChildren(principal.getId(), id, pageable))));
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
    public ResponseEntity<ApiResponse<DocumentTreeNodeResponse>> move(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable UUID id,
            @Valid @RequestBody DocumentMoveRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(documentTreeService.move(principal.getId(), id, request)));
    }
}
