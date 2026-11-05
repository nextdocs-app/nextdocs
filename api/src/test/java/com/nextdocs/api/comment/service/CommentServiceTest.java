package com.nextdocs.api.comment.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.comment.dto.request.CommentBodyRequest;
import com.nextdocs.api.comment.dto.response.CommentResponse;
import com.nextdocs.api.comment.dto.response.ThreadResponse;
import com.nextdocs.api.comment.entity.Comment;
import com.nextdocs.api.comment.entity.CommentReaction;
import com.nextdocs.api.comment.entity.CommentThread;
import com.nextdocs.api.comment.repository.CommentReactionRepository;
import com.nextdocs.api.comment.repository.CommentRepository;
import com.nextdocs.api.comment.repository.CommentThreadRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.service.PermissionService;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import tools.jackson.databind.ObjectMapper;

/**
 * Tests permission gating, abilities resolution, reactions, and thread lifecycle
 * for the API-backed comments service.
 *
 * <pre>
 * Permission Matrix:
 *
 * Caller              | Read threads | Create/reply | Edit/delete own | Delete any | Resolve | React
 * VIEW                | no           | no           | no              | no         | no      | no
 * COMMENT member      | yes          | yes          | yes             | no         | yes     | yes
 * EDIT/OWNER member   | yes          | yes          | yes             | yes        | yes     | yes
 * Guest, COMMENT link | yes          | yes          | no              | no         | yes     | no
 * Guest, EDIT link    | yes          | yes          | no              | no         | yes     | no
 * </pre>
 *
 * Guests have no stable identity, so authorship cannot be proven and guest comments
 * cannot be edited/deleted by the guest or reacted to. Deletion of threads/comments
 * requires an authenticated author or editor.
 */
@ExtendWith(MockitoExtension.class)
class CommentServiceTest {

    @Mock
    private CommentThreadRepository threadRepository;

    @Mock
    private CommentRepository commentRepository;

    @Mock
    private CommentReactionRepository reactionRepository;

    @Mock
    private UserRepository userRepository;

    @Mock
    private PermissionService permissionService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private CommentService commentService;

    private UUID userId;
    private UUID documentId;
    private UUID threadId;
    private UUID commentId;
    private User user;
    private Document document;

    @BeforeEach
    void setUp() {
        commentService = new CommentService(
                threadRepository,
                commentRepository,
                reactionRepository,
                userRepository,
                permissionService,
                objectMapper);
        userId = UUID.randomUUID();
        documentId = UUID.randomUUID();
        threadId = UUID.randomUUID();
        commentId = UUID.randomUUID();
        user = User.builder()
                .id(userId)
                .email("alice@example.com")
                .displayName("Alice")
                .build();
        document = Document.builder().id(documentId).title("Doc").build();
    }

    @Test
    void listThreads_viewOnly_isRejectedByTheGate() {
        when(permissionService.requireCommentAccess(userId, documentId))
                .thenThrow(new ApiException(ErrorCode.FORBIDDEN));

        ApiException exception = assertThrows(ApiException.class, () -> commentService.listThreads(userId, documentId));

        assertEquals(ErrorCode.FORBIDDEN, exception.getErrorCode());
        verify(threadRepository, never()).findAllByDocument_IdOrderByCreatedAtAscIdAsc(any());
    }

    @Test
    void listThreads_mapsAuthorsResolutionsAndAbilities() {
        stubIdentity(DocumentAccessLevel.COMMENT);
        CommentThread thread = thread(threadId, false);
        Comment mine = comment(commentId, thread, user, userId, "Alice", "[]");
        UUID otherId = UUID.randomUUID();
        Comment other = comment(
                UUID.randomUUID(),
                thread,
                User.builder().id(otherId).displayName("Bob").build(),
                otherId,
                "Bob",
                "[]");

        when(threadRepository.findAllByDocument_IdOrderByCreatedAtAscIdAsc(documentId))
                .thenReturn(List.of(thread));
        when(commentRepository.findAllByThread_IdInOrderByCreatedAtAscIdAsc(anyCollection()))
                .thenReturn(List.of(mine, other));
        when(reactionRepository.findAllByComment_IdIn(anyCollection())).thenReturn(List.of());

        List<ThreadResponse> threads = commentService.listThreads(userId, documentId);

        assertEquals(1, threads.size());
        ThreadResponse response = threads.getFirst();
        assertFalse(response.abilities().delete(), "COMMENT cannot delete a thread");
        assertTrue(response.abilities().resolve());
        assertTrue(response.comments().get(0).abilities().update(), "own comment is editable");
        assertFalse(response.comments().get(1).abilities().update(), "another author's comment is not");
        assertTrue(response.comments().get(0).abilities().reactions());
        assertEquals("Alice", response.comments().get(0).author().displayName());
    }

    @Test
    void getThread_ownedByAnotherDocument_isNotFound() {
        stubGuestAccess(DocumentAccessLevel.COMMENT);
        when(threadRepository.findByIdAndDocument_Id(threadId, documentId)).thenReturn(Optional.empty());

        ApiException exception =
                assertThrows(ApiException.class, () -> commentService.getThread(null, documentId, threadId));

        assertEquals(ErrorCode.NOT_FOUND, exception.getErrorCode());
    }

    @Test
    void createThread_guest_recordsGuestSnapshotAndNoUser() {
        stubGuestAccess(DocumentAccessLevel.COMMENT);
        when(threadRepository.saveAndFlush(any(CommentThread.class))).thenAnswer(invocation -> {
            CommentThread saved = invocation.getArgument(0);
            saved.setId(threadId);
            saved.setCreatedAt(now());
            saved.setUpdatedAt(now());
            return saved;
        });
        when(commentRepository.saveAndFlush(any(Comment.class))).thenAnswer(invocation -> {
            Comment saved = invocation.getArgument(0);
            saved.setId(commentId);
            saved.setCreatedAt(now());
            saved.setUpdatedAt(now());
            return saved;
        });

        ThreadResponse response = commentService.createThread(null, documentId, body("[{\"type\":\"paragraph\"}]"));

        assertEquals(threadId, response.id());
        assertNull(response.comments().getFirst().author().id());
        assertEquals("Guest", response.comments().getFirst().author().displayName());
        assertEquals(1, response.comments().size());

        ArgumentCaptor<CommentThread> threadCaptor = ArgumentCaptor.forClass(CommentThread.class);
        verify(threadRepository).saveAndFlush(threadCaptor.capture());
        assertNull(threadCaptor.getValue().getCreatedBy());

        ArgumentCaptor<Comment> commentCaptor = ArgumentCaptor.forClass(Comment.class);
        verify(commentRepository).saveAndFlush(commentCaptor.capture());
        assertNull(commentCaptor.getValue().getAuthor());
        assertNull(commentCaptor.getValue().getAuthorUserKey());
    }

    @Test
    void createThread_rejectsEmptyBodyBeforeWriting() {
        stubIdentity(DocumentAccessLevel.COMMENT);

        ApiException exception =
                assertThrows(ApiException.class, () -> commentService.createThread(userId, documentId, body("[]")));

        assertEquals(ErrorCode.VALIDATION_FAILED, exception.getErrorCode());
        verify(threadRepository, never()).saveAndFlush(any());
    }

    @Test
    void createThread_rejectsNonObjectBlocksInBody() {
        stubIdentity(DocumentAccessLevel.COMMENT);

        ApiException exception = assertThrows(
                ApiException.class, () -> commentService.createThread(userId, documentId, body("[\"not an object\"]")));

        assertEquals(ErrorCode.VALIDATION_FAILED, exception.getErrorCode());
        verify(threadRepository, never()).saveAndFlush(any());
    }

    @Test
    void createThread_rejectsOversizedBody() {
        stubIdentity(DocumentAccessLevel.COMMENT);
        String huge = "[{\"type\":\"paragraph\",\"text\":\"" + "x".repeat(CommentService.MAX_BODY_BYTES) + "\"}]";

        ApiException exception =
                assertThrows(ApiException.class, () -> commentService.createThread(userId, documentId, body(huge)));

        assertEquals(ErrorCode.VALIDATION_FAILED, exception.getErrorCode());
    }

    @Test
    void addComment_nonEmptyBody_returnsSavedComment() {
        stubIdentity(DocumentAccessLevel.COMMENT);
        CommentThread thread = thread(threadId, false);
        when(threadRepository.findByIdAndDocument_Id(threadId, documentId)).thenReturn(Optional.of(thread));
        when(commentRepository.saveAndFlush(any(Comment.class))).thenAnswer(invocation -> {
            Comment saved = invocation.getArgument(0);
            saved.setId(commentId);
            return saved;
        });

        CommentResponse response =
                commentService.addComment(userId, documentId, threadId, body("[{\"type\":\"paragraph\"}]"));

        assertEquals(commentId, response.id());
        assertEquals(userId, response.author().id());
        // The API owns both times; resting on the entity's pre-persist hook would
        // only be exercised by H2 and would hide a missing value in production.
        assertNotNull(response.createdAt());
        assertNotNull(response.updatedAt());
        assertTrue(response.abilities().update());
    }

    @Test
    void updateComment_nonAuthor_isForbidden() {
        stubIdentity(DocumentAccessLevel.COMMENT);
        CommentThread thread = thread(threadId, false);
        Comment other = comment(
                commentId, thread, User.builder().id(UUID.randomUUID()).build(), UUID.randomUUID(), "Bob", "[]");
        when(threadRepository.findByIdAndDocument_Id(threadId, documentId)).thenReturn(Optional.of(thread));
        when(commentRepository.findByIdAndThread_Id(commentId, threadId)).thenReturn(Optional.of(other));

        assertThrows(
                ApiException.class,
                () -> commentService.updateComment(userId, documentId, threadId, commentId, body("[]")));
        verify(commentRepository, never()).save(any());
    }

    @Test
    void updateComment_author_updatesBodyAndThreadTimestamp() {
        stubIdentity(DocumentAccessLevel.COMMENT);
        CommentThread thread = thread(threadId, false);
        Comment mine = comment(commentId, thread, user, userId, "Alice", "[]");
        when(threadRepository.findByIdAndDocument_Id(threadId, documentId)).thenReturn(Optional.of(thread));
        when(commentRepository.findByIdAndThread_Id(commentId, threadId)).thenReturn(Optional.of(mine));

        commentService.updateComment(
                userId, documentId, threadId, commentId, body("[{\"type\":\"paragraph\",\"content\":\"edited\"}]"));

        assertTrue(mine.getBody().contains("edited"));
        verify(commentRepository).save(mine);
        verify(threadRepository).save(thread);
    }

    @Test
    void deleteComment_lastComment_removesTheThread() {
        stubIdentity(DocumentAccessLevel.COMMENT);
        CommentThread thread = thread(threadId, false);
        Comment mine = comment(commentId, thread, user, userId, "Alice", "[]");
        when(threadRepository.findByIdAndDocument_Id(threadId, documentId)).thenReturn(Optional.of(thread));
        when(commentRepository.findByIdAndThread_Id(commentId, threadId)).thenReturn(Optional.of(mine));
        when(commentRepository.countByThread_Id(threadId)).thenReturn(1L);

        commentService.deleteComment(userId, documentId, threadId, commentId);

        verify(threadRepository).delete(thread);
        verify(commentRepository, never()).delete(any());
    }

    @Test
    void deleteComment_editor_canDeleteAnotherAuthorsComment() {
        stubIdentity(DocumentAccessLevel.EDIT);
        CommentThread thread = thread(threadId, false);
        Comment other = comment(
                commentId, thread, User.builder().id(UUID.randomUUID()).build(), UUID.randomUUID(), "Bob", "[]");
        when(threadRepository.findByIdAndDocument_Id(threadId, documentId)).thenReturn(Optional.of(thread));
        when(commentRepository.findByIdAndThread_Id(commentId, threadId)).thenReturn(Optional.of(other));
        when(commentRepository.countByThread_Id(threadId)).thenReturn(2L);

        commentService.deleteComment(userId, documentId, threadId, commentId);

        verify(commentRepository).delete(other);
        verify(threadRepository).save(thread);
    }

    @Test
    void deleteThread_commentLevel_isForbidden() {
        stubIdentity(DocumentAccessLevel.COMMENT);
        CommentThread thread = thread(threadId, false);
        when(threadRepository.findByIdAndDocument_Id(threadId, documentId)).thenReturn(Optional.of(thread));

        assertThrows(ApiException.class, () -> commentService.deleteThread(userId, documentId, threadId));
        verify(threadRepository, never()).delete(any());
    }

    @Test
    void deleteThread_editLevel_deletes() {
        stubIdentity(DocumentAccessLevel.EDIT);
        CommentThread thread = thread(threadId, false);
        when(threadRepository.findByIdAndDocument_Id(threadId, documentId)).thenReturn(Optional.of(thread));

        commentService.deleteThread(userId, documentId, threadId);

        verify(threadRepository).delete(thread);
    }

    @Test
    void resolveThread_recordsTheActor() {
        stubIdentity(DocumentAccessLevel.COMMENT);
        CommentThread thread = thread(threadId, false);
        when(threadRepository.findByIdAndDocument_Id(threadId, documentId)).thenReturn(Optional.of(thread));

        commentService.resolveThread(userId, documentId, threadId);

        assertTrue(thread.isResolved());
        assertEquals(user, thread.getResolvedBy());
        assertEquals(userId, thread.getResolvedByUserKey());
        assertEquals("Alice", thread.getResolvedByName());
        assertTrue(thread.getResolvedAt() != null);
        verify(threadRepository).save(thread);
    }

    @Test
    void unresolveThread_clearsResolution() {
        stubIdentity(DocumentAccessLevel.COMMENT);
        CommentThread thread = thread(threadId, true);
        thread.setResolvedByUserKey(userId);
        when(threadRepository.findByIdAndDocument_Id(threadId, documentId)).thenReturn(Optional.of(thread));

        commentService.unresolveThread(userId, documentId, threadId);

        assertFalse(thread.isResolved());
        assertNull(thread.getResolvedBy());
        assertNull(thread.getResolvedByUserKey());
        assertNull(thread.getResolvedByName());
        assertNull(thread.getResolvedAt());
    }

    @Test
    void listThreads_preservesDeletedResolverUserKey() {
        stubIdentity(DocumentAccessLevel.COMMENT);
        UUID deletedResolverKey = UUID.randomUUID();
        CommentThread thread = thread(threadId, true);
        thread.setResolvedBy(null);
        thread.setResolvedByUserKey(deletedResolverKey);
        thread.setResolvedByName("Former Resolver");

        when(threadRepository.findAllByDocument_IdOrderByCreatedAtAscIdAsc(documentId))
                .thenReturn(List.of(thread));
        when(commentRepository.findAllByThread_IdInOrderByCreatedAtAscIdAsc(anyCollection()))
                .thenReturn(List.of());

        ThreadResponse response = commentService.listThreads(userId, documentId).getFirst();

        assertTrue(response.resolved());
        assertNotNull(response.resolvedBy());
        assertEquals(deletedResolverKey, response.resolvedBy().id());
        assertEquals("Former Resolver", response.resolvedBy().displayName());
    }

    @Test
    void addReaction_anonymous_isForbidden() {
        stubGuestAccess(DocumentAccessLevel.COMMENT);
        CommentThread thread = thread(threadId, false);
        Comment mine = comment(commentId, thread, user, userId, "Alice", "[]");
        when(threadRepository.findByIdAndDocument_Id(threadId, documentId)).thenReturn(Optional.of(thread));
        when(commentRepository.findByIdAndThread_Id(commentId, threadId)).thenReturn(Optional.of(mine));

        assertThrows(ApiException.class, () -> commentService.addReaction(null, documentId, threadId, commentId, "👍"));
        verify(reactionRepository, never()).saveAndFlush(any());
    }

    @Test
    void addReaction_identifiedCaller_savesTheReactionAndTouchesTheThread() {
        stubIdentity(DocumentAccessLevel.COMMENT);
        CommentThread thread = thread(threadId, false);
        Comment mine = comment(commentId, thread, user, userId, "Alice", "[]");
        when(threadRepository.findByIdAndDocument_Id(threadId, documentId)).thenReturn(Optional.of(thread));
        when(commentRepository.findByIdAndThread_Id(commentId, threadId)).thenReturn(Optional.of(mine));
        when(reactionRepository.findByComment_IdAndUser_IdAndEmoji(commentId, userId, "👍"))
                .thenReturn(Optional.empty());

        commentService.addReaction(userId, documentId, threadId, commentId, "👍");

        ArgumentCaptor<CommentReaction> captor = ArgumentCaptor.forClass(CommentReaction.class);
        verify(reactionRepository).saveAndFlush(captor.capture());
        assertEquals("👍", captor.getValue().getEmoji());
        assertEquals(userId, captor.getValue().getUser().getId());
        verify(threadRepository).save(thread);
    }

    @Test
    void addReaction_uniqueConstraintRace_isReportedAsConflict() {
        stubIdentity(DocumentAccessLevel.COMMENT);
        CommentThread thread = thread(threadId, false);
        Comment mine = comment(commentId, thread, user, userId, "Alice", "[]");
        when(threadRepository.findByIdAndDocument_Id(threadId, documentId)).thenReturn(Optional.of(thread));
        when(commentRepository.findByIdAndThread_Id(commentId, threadId)).thenReturn(Optional.of(mine));
        when(reactionRepository.findByComment_IdAndUser_IdAndEmoji(commentId, userId, "👍"))
                .thenReturn(Optional.empty());
        when(reactionRepository.saveAndFlush(any(CommentReaction.class)))
                .thenThrow(new org.springframework.dao.DataIntegrityViolationException("duplicate"));

        ApiException exception = assertThrows(
                ApiException.class, () -> commentService.addReaction(userId, documentId, threadId, commentId, "👍"));

        assertEquals(ErrorCode.CONFLICT, exception.getErrorCode());
    }

    @Test
    void addReaction_duplicate_isConflict() {
        stubIdentity(DocumentAccessLevel.COMMENT);
        CommentThread thread = thread(threadId, false);
        Comment mine = comment(commentId, thread, user, userId, "Alice", "[]");
        when(threadRepository.findByIdAndDocument_Id(threadId, documentId)).thenReturn(Optional.of(thread));
        when(commentRepository.findByIdAndThread_Id(commentId, threadId)).thenReturn(Optional.of(mine));
        when(reactionRepository.findByComment_IdAndUser_IdAndEmoji(commentId, userId, "👍"))
                .thenReturn(Optional.of(CommentReaction.builder().build()));

        ApiException exception = assertThrows(
                ApiException.class, () -> commentService.addReaction(userId, documentId, threadId, commentId, "👍"));

        assertEquals(ErrorCode.CONFLICT, exception.getErrorCode());
    }

    @Test
    void addReaction_rejectsEmojiContainingSlash() {
        stubIdentity(DocumentAccessLevel.COMMENT);
        CommentThread thread = thread(threadId, false);
        Comment mine = comment(commentId, thread, user, userId, "Alice", "[]");
        when(threadRepository.findByIdAndDocument_Id(threadId, documentId)).thenReturn(Optional.of(thread));
        when(commentRepository.findByIdAndThread_Id(commentId, threadId)).thenReturn(Optional.of(mine));

        ApiException exception = assertThrows(
                ApiException.class,
                () -> commentService.addReaction(userId, documentId, threadId, commentId, "bad/emoji"));

        assertEquals(ErrorCode.VALIDATION_FAILED, exception.getErrorCode());
        verify(reactionRepository, never()).save(any());
    }

    @Test
    void removeReaction_missing_isNotFound() {
        stubIdentity(DocumentAccessLevel.COMMENT);
        CommentThread thread = thread(threadId, false);
        Comment mine = comment(commentId, thread, user, userId, "Alice", "[]");
        when(threadRepository.findByIdAndDocument_Id(threadId, documentId)).thenReturn(Optional.of(thread));
        when(commentRepository.findByIdAndThread_Id(commentId, threadId)).thenReturn(Optional.of(mine));
        when(reactionRepository.findByComment_IdAndUser_IdAndEmoji(commentId, userId, "👍"))
                .thenReturn(Optional.empty());

        assertThrows(
                ApiException.class, () -> commentService.removeReaction(userId, documentId, threadId, commentId, "👍"));
    }

    @Test
    void listThreads_aggregatesReactionsAndDeletedAuthorSnapshots() {
        stubIdentity(DocumentAccessLevel.COMMENT);
        CommentThread thread = thread(threadId, false);
        UUID deletedAuthorKey = UUID.randomUUID();
        Comment deletedAuthor = comment(commentId, thread, null, deletedAuthorKey, "Former Member", "[]");
        CommentReaction first = CommentReaction.builder()
                .comment(deletedAuthor)
                .user(user)
                .emoji("👍")
                .createdAt(now())
                .build();
        CommentReaction second = CommentReaction.builder()
                .comment(deletedAuthor)
                .user(User.builder().id(UUID.randomUUID()).displayName("Bob").build())
                .emoji("👍")
                .createdAt(now().plusSeconds(1))
                .build();

        when(threadRepository.findAllByDocument_IdOrderByCreatedAtAscIdAsc(documentId))
                .thenReturn(List.of(thread));
        when(commentRepository.findAllByThread_IdInOrderByCreatedAtAscIdAsc(anyCollection()))
                .thenReturn(List.of(deletedAuthor));
        when(reactionRepository.findAllByComment_IdIn(anyCollection())).thenReturn(List.of(first, second));

        ThreadResponse response = commentService.listThreads(userId, documentId).getFirst();
        CommentResponse comment = response.comments().getFirst();

        assertEquals(deletedAuthorKey, comment.author().id());
        assertEquals("Former Member", comment.author().displayName());
        assertEquals(1, comment.reactions().size());
        assertEquals("👍", comment.reactions().getFirst().emoji());
        assertEquals(2, comment.reactions().getFirst().users().size());
    }

    @Test
    void deleteComment_guestWithEditLink_isForbidden() {
        stubGuestAccess(DocumentAccessLevel.EDIT);
        CommentThread thread = thread(threadId, false);
        Comment comment = comment(commentId, thread, user, userId, "Alice", "[]");
        when(threadRepository.findByIdAndDocument_Id(threadId, documentId)).thenReturn(Optional.of(thread));
        when(commentRepository.findByIdAndThread_Id(commentId, threadId)).thenReturn(Optional.of(comment));

        ApiException ex = assertThrows(
                ApiException.class, () -> commentService.deleteComment(null, documentId, threadId, commentId));
        assertEquals(ErrorCode.FORBIDDEN, ex.getErrorCode());
        verify(commentRepository, never()).delete(any());
        verify(threadRepository, never()).delete(any());
    }

    @Test
    void deleteThread_guestWithEditLink_isForbidden() {
        stubGuestAccess(DocumentAccessLevel.EDIT);
        CommentThread thread = thread(threadId, false);
        when(threadRepository.findByIdAndDocument_Id(threadId, documentId)).thenReturn(Optional.of(thread));

        ApiException ex =
                assertThrows(ApiException.class, () -> commentService.deleteThread(null, documentId, threadId));
        assertEquals(ErrorCode.FORBIDDEN, ex.getErrorCode());
        verify(threadRepository, never()).delete(any());
    }

    @Test
    void getThread_guestWithEditLink_abilitiesDenyDelete() {
        stubGuestAccess(DocumentAccessLevel.EDIT);
        CommentThread thread = thread(threadId, false);
        Comment comment = comment(commentId, thread, user, userId, "Alice", "[]");
        when(threadRepository.findByIdAndDocument_Id(threadId, documentId)).thenReturn(Optional.of(thread));
        when(commentRepository.findAllByThread_IdInOrderByCreatedAtAscIdAsc(List.of(threadId)))
                .thenReturn(List.of(comment));
        when(reactionRepository.findAllByComment_IdIn(List.of(commentId))).thenReturn(List.of());

        ThreadResponse response = commentService.getThread(null, documentId, threadId);

        assertFalse(response.abilities().delete());
        assertFalse(response.comments().getFirst().abilities().delete());
    }

    private void stubIdentity(DocumentAccessLevel level) {
        when(permissionService.requireCommentAccess(userId, documentId))
                .thenReturn(new PermissionService.DocumentCommentAccess(document, level));
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
    }

    private void stubGuestAccess(DocumentAccessLevel level) {
        when(permissionService.requirePublicCommentAccess(documentId))
                .thenReturn(new PermissionService.DocumentCommentAccess(document, level));
    }

    private CommentBodyRequest body(String json) {
        return new CommentBodyRequest(objectMapper.readTree(json));
    }

    private CommentThread thread(UUID id, boolean resolved) {
        return CommentThread.builder()
                .id(id)
                .document(document)
                .resolved(resolved)
                .createdAt(now())
                .updatedAt(now())
                .build();
    }

    private Comment comment(
            UUID id, CommentThread thread, User author, UUID authorKey, String authorName, String body) {
        return Comment.builder()
                .id(id)
                .thread(thread)
                .author(author)
                .authorUserKey(authorKey)
                .authorName(authorName)
                .body(body)
                .createdAt(now())
                .updatedAt(now())
                .build();
    }

    private static OffsetDateTime now() {
        return OffsetDateTime.now(ZoneOffset.UTC);
    }
}
