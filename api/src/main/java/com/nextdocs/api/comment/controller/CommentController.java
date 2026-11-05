package com.nextdocs.api.comment.controller;

import static com.nextdocs.api.auth.security.BearerTokens.rejectInvalidBearer;

import com.nextdocs.api.auth.security.UserPrincipal;
import com.nextdocs.api.comment.dto.request.CommentBodyRequest;
import com.nextdocs.api.comment.dto.request.ReactionRequest;
import com.nextdocs.api.comment.dto.response.CommentResponse;
import com.nextdocs.api.comment.dto.response.ThreadResponse;
import com.nextdocs.api.comment.service.CommentService;
import com.nextdocs.api.common.response.ApiResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Comment threads and replies. Authentication is optional on every route: a signed-in
 * caller is authorized through their document access, while an anonymous visitor is
 * authorized through the share link's effective level (COMMENT and EDIT grant discussion;
 * comment deletion requires an authenticated user). A presented-but-invalid Bearer token fails
 * closed rather than falling back to the link level.
 *
 * <p>These routes are permitted by the security filter (the service is the authority)
 * so the editor can use one URL shape for members and guests.
 */
@Tag(
        name = "Comments",
        description = "Threaded document comments. Bearer authentication is optional; "
                + "anonymous callers are evaluated against the share link.")
@RestController
@RequestMapping("/api/v1/documents")
@RequiredArgsConstructor
@SecurityRequirement(name = "bearerAuth")
public class CommentController {

    /** Request-mapping paths, exposed so tests use the real strings. */
    public static final String THREADS_PATH = "/api/v1/documents/{documentId}/threads";

    public static final String IMPORT_PATH = THREADS_PATH + "/import";
    public static final String THREAD_PATH = THREADS_PATH + "/{threadId}";
    public static final String RESOLVE_PATH = THREAD_PATH + "/resolve";
    public static final String UNRESOLVE_PATH = THREAD_PATH + "/unresolve";
    public static final String COMMENTS_PATH = THREAD_PATH + "/comments";
    public static final String COMMENT_PATH = COMMENTS_PATH + "/{commentId}";
    public static final String REACTIONS_PATH = COMMENT_PATH + "/reactions";
    public static final String REACTION_PATH = REACTIONS_PATH + "/{emoji}";

    private final CommentService commentService;

    @Operation(summary = "List comment threads", description = "Requires COMMENT access or a COMMENT-level share link.")
    @GetMapping("/{documentId}/threads")
    public ResponseEntity<ApiResponse<List<ThreadResponse>>> list(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
            @PathVariable UUID documentId) {
        return ResponseEntity.ok(
                ApiResponse.ok(commentService.listThreads(callerId(principal, authorization), documentId)));
    }

    @Operation(summary = "Get one comment thread")
    @GetMapping("/{documentId}/threads/{threadId}")
    public ResponseEntity<ApiResponse<ThreadResponse>> get(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
            @PathVariable UUID documentId,
            @PathVariable UUID threadId) {
        return ResponseEntity.ok(
                ApiResponse.ok(commentService.getThread(callerId(principal, authorization), documentId, threadId)));
    }

    @Operation(
            summary = "Create a comment thread",
            description = "Creates the thread and its first comment. The BlockNote anchor mark is "
                    + "applied by the editor, not by the API.")
    @PostMapping("/{documentId}/threads")
    public ResponseEntity<ApiResponse<ThreadResponse>> create(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
            @PathVariable UUID documentId,
            @Valid @RequestBody CommentBodyRequest request) {
        ThreadResponse response = commentService.createThread(callerId(principal, authorization), documentId, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(response, "Thread created."));
    }

    @Operation(summary = "Delete a comment thread", description = "Requires document edit access.")
    @DeleteMapping("/{documentId}/threads/{threadId}")
    public ResponseEntity<Void> delete(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
            @PathVariable UUID documentId,
            @PathVariable UUID threadId) {
        commentService.deleteThread(callerId(principal, authorization), documentId, threadId);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "Resolve a comment thread")
    @PostMapping("/{documentId}/threads/{threadId}/resolve")
    public ResponseEntity<Void> resolve(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
            @PathVariable UUID documentId,
            @PathVariable UUID threadId) {
        commentService.resolveThread(callerId(principal, authorization), documentId, threadId);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "Reopen a comment thread")
    @PostMapping("/{documentId}/threads/{threadId}/unresolve")
    public ResponseEntity<Void> unresolve(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
            @PathVariable UUID documentId,
            @PathVariable UUID threadId) {
        commentService.unresolveThread(callerId(principal, authorization), documentId, threadId);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "Reply to a thread")
    @PostMapping("/{documentId}/threads/{threadId}/comments")
    public ResponseEntity<ApiResponse<CommentResponse>> addComment(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
            @PathVariable UUID documentId,
            @PathVariable UUID threadId,
            @Valid @RequestBody CommentBodyRequest request) {
        CommentResponse response =
                commentService.addComment(callerId(principal, authorization), documentId, threadId, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(response, "Comment added."));
    }

    @Operation(summary = "Edit a comment", description = "Only the author may edit.")
    @PatchMapping("/{documentId}/threads/{threadId}/comments/{commentId}")
    public ResponseEntity<Void> updateComment(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
            @PathVariable UUID documentId,
            @PathVariable UUID threadId,
            @PathVariable UUID commentId,
            @Valid @RequestBody CommentBodyRequest request) {
        commentService.updateComment(callerId(principal, authorization), documentId, threadId, commentId, request);
        return ResponseEntity.noContent().build();
    }

    @Operation(
            summary = "Delete a comment",
            description = "The author, or a caller with document edit access, may delete. "
                    + "Deleting the last comment removes the thread.")
    @DeleteMapping("/{documentId}/threads/{threadId}/comments/{commentId}")
    public ResponseEntity<Void> deleteComment(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
            @PathVariable UUID documentId,
            @PathVariable UUID threadId,
            @PathVariable UUID commentId) {
        commentService.deleteComment(callerId(principal, authorization), documentId, threadId, commentId);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "React to a comment", description = "Requires an identified caller.")
    @PostMapping("/{documentId}/threads/{threadId}/comments/{commentId}/reactions")
    public ResponseEntity<Void> addReaction(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
            @PathVariable UUID documentId,
            @PathVariable UUID threadId,
            @PathVariable UUID commentId,
            @Valid @RequestBody ReactionRequest request) {
        commentService.addReaction(
                callerId(principal, authorization), documentId, threadId, commentId, request.emoji());
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "Remove a reaction", description = "Only the reacting caller may remove it.")
    @DeleteMapping("/{documentId}/threads/{threadId}/comments/{commentId}/reactions/{emoji}")
    public ResponseEntity<Void> removeReaction(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
            @PathVariable UUID documentId,
            @PathVariable UUID threadId,
            @PathVariable UUID commentId,
            @PathVariable String emoji) {
        commentService.removeReaction(callerId(principal, authorization), documentId, threadId, commentId, emoji);
        return ResponseEntity.noContent().build();
    }

    /**
     * Null means anonymous: the service resolves the share-link level. A caller that
     * presented a Bearer token but was not authenticated is rejected instead.
     */
    private static UUID callerId(UserPrincipal principal, String authorization) {
        if (principal != null) {
            return principal.getId();
        }
        rejectInvalidBearer(authorization);
        return null;
    }
}
