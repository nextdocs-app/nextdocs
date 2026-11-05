package com.nextdocs.api.comment.service;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.comment.dto.request.CommentBodyRequest;
import com.nextdocs.api.comment.dto.response.CommentAbilitiesResponse;
import com.nextdocs.api.comment.dto.response.CommentAuthorResponse;
import com.nextdocs.api.comment.dto.response.CommentReactionResponse;
import com.nextdocs.api.comment.dto.response.CommentResponse;
import com.nextdocs.api.comment.dto.response.ThreadAbilitiesResponse;
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
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Owns comment threads, replies, resolutions, and reactions now that they no longer
 * live in the collaborative Y.Doc. Access is resolved once per request through
 * {@link PermissionService#requireCommentAccess} (identity) or
 * {@link PermissionService#requirePublicCommentAccess} (share link), and every
 * mutation re-checks the rule that the response advertises as an ability.
 *
 * <p>Anonymous link commenters are first-class writers on a COMMENT/EDIT link,
 * exactly as the Docs reference allows: their rows carry no user FK and the
 * snapshot name "Guest". They cannot edit or delete comments (there is no identity
 * to prove authorship, and guests cannot delete content), and cannot react (a reaction
 * must be removable by the person who added it). Comment and thread deletion requires
 * an authenticated author or editor.
 *
 * <p>Legacy import from experimental pre-release Y.Doc comment roots was omitted:
 * as the project is unreleased with zero production users, the risk of data loss
 * does not justify building or maintaining a throwaway data migration pipeline.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CommentService {

    /** BlockNote comment bodies are a few paragraphs at most; 16 KB is generous. */
    static final int MAX_BODY_BYTES = 16 * 1024;

    static final String GUEST_NAME = "Guest";

    /** The client-side id BlockNote gives anonymous commenters. */
    static final String GUEST_USER_ID = "anonymous";

    private final CommentThreadRepository threadRepository;
    private final CommentRepository commentRepository;
    private final CommentReactionRepository reactionRepository;
    private final UserRepository userRepository;
    private final PermissionService permissionService;
    private final ObjectMapper objectMapper;

    /** The resolved caller plus the document and level that admitted them. */
    private record Caller(UUID userId, User user, String displayName, Document document, DocumentAccessLevel level) {

        boolean canEdit() {
            return level.allowsEdit();
        }

        boolean isAnonymous() {
            return userId == null;
        }

        boolean isAuthor(Comment comment) {
            return userId != null && userId.equals(comment.getAuthorUserKey());
        }
    }

    @Transactional(readOnly = true)
    public List<ThreadResponse> listThreads(UUID callerId, UUID documentId) {
        Caller caller = resolveCaller(callerId, documentId);
        List<CommentThread> threads = threadRepository.findAllByDocument_IdOrderByCreatedAtAscIdAsc(documentId);
        return toThreadResponses(caller, threads);
    }

    @Transactional(readOnly = true)
    public ThreadResponse getThread(UUID callerId, UUID documentId, UUID threadId) {
        Caller caller = resolveCaller(callerId, documentId);
        CommentThread thread = requireThread(documentId, threadId);
        return toThreadResponses(caller, List.of(thread)).getFirst();
    }

    @Transactional
    public ThreadResponse createThread(UUID callerId, UUID documentId, CommentBodyRequest request) {
        Caller caller = resolveCaller(callerId, documentId);
        String body = normalizeBody(request.body());

        OffsetDateTime createdAt = now();
        CommentThread savedThread = threadRepository.saveAndFlush(CommentThread.builder()
                .id(UUID.randomUUID())
                .document(caller.document())
                .createdBy(caller.user())
                .createdAt(createdAt)
                .updatedAt(createdAt)
                .build());
        Comment savedComment = commentRepository.saveAndFlush(Comment.builder()
                .id(UUID.randomUUID())
                .thread(savedThread)
                .author(caller.user())
                .authorUserKey(caller.userId())
                .authorName(caller.displayName())
                .body(body)
                .createdAt(createdAt)
                .updatedAt(createdAt)
                .build());

        return toThreadResponse(caller, savedThread, List.of(savedComment), Map.of());
    }

    @Transactional
    public CommentResponse addComment(UUID callerId, UUID documentId, UUID threadId, CommentBodyRequest request) {
        Caller caller = resolveCaller(callerId, documentId);
        CommentThread thread = requireThread(documentId, threadId);
        String body = normalizeBody(request.body());

        OffsetDateTime createdAt = now();
        Comment comment = Comment.builder()
                .id(UUID.randomUUID())
                .thread(thread)
                .author(caller.user())
                .authorUserKey(caller.userId())
                .authorName(caller.displayName())
                .body(body)
                .createdAt(createdAt)
                .updatedAt(createdAt)
                .build();
        Comment saved = commentRepository.saveAndFlush(comment);
        touchThread(thread);
        return toCommentResponse(caller, saved, List.of());
    }

    @Transactional
    public void updateComment(
            UUID callerId, UUID documentId, UUID threadId, UUID commentId, CommentBodyRequest request) {
        Caller caller = resolveCaller(callerId, documentId);
        CommentThread thread = requireThread(documentId, threadId);
        Comment comment = requireComment(thread, commentId);
        if (!caller.isAuthor(comment)) {
            throw new ApiException(ErrorCode.FORBIDDEN);
        }

        comment.setBody(normalizeBody(request.body()));
        comment.setUpdatedAt(now());
        commentRepository.save(comment);
        touchThread(thread);
    }

    @Transactional
    public void deleteComment(UUID callerId, UUID documentId, UUID threadId, UUID commentId) {
        Caller caller = resolveCaller(callerId, documentId);
        CommentThread thread = requireThread(documentId, threadId);
        Comment comment = requireComment(thread, commentId);
        if (caller.isAnonymous() || (!caller.isAuthor(comment) && !caller.canEdit())) {
            throw new ApiException(ErrorCode.FORBIDDEN);
        }

        if (commentRepository.countByThread_Id(threadId) <= 1) {
            // A thread without comments has nothing to render and no way back into
            // the sidebar; removing it matches the reference and keeps the list honest.
            threadRepository.delete(thread);
            return;
        }

        commentRepository.delete(comment);
        touchThread(thread);
    }

    @Transactional
    public void deleteThread(UUID callerId, UUID documentId, UUID threadId) {
        Caller caller = resolveCaller(callerId, documentId);
        CommentThread thread = requireThread(documentId, threadId);
        if (caller.isAnonymous() || !caller.canEdit()) {
            throw new ApiException(ErrorCode.FORBIDDEN);
        }
        threadRepository.delete(thread);
    }

    @Transactional
    public void resolveThread(UUID callerId, UUID documentId, UUID threadId) {
        Caller caller = resolveCaller(callerId, documentId);
        CommentThread thread = requireThread(documentId, threadId);
        if (thread.isResolved()) {
            return;
        }
        OffsetDateTime resolvedAt = now();
        thread.setResolved(true);
        thread.setResolvedAt(resolvedAt);
        thread.setResolvedBy(caller.user());
        thread.setResolvedByUserKey(caller.userId());
        thread.setResolvedByName(truncate(caller.displayName(), 255));
        thread.setUpdatedAt(resolvedAt);
        threadRepository.save(thread);
    }

    @Transactional
    public void unresolveThread(UUID callerId, UUID documentId, UUID threadId) {
        resolveCaller(callerId, documentId);
        CommentThread thread = requireThread(documentId, threadId);
        if (!thread.isResolved()) {
            return;
        }
        thread.setResolved(false);
        thread.setResolvedAt(null);
        thread.setResolvedBy(null);
        thread.setResolvedByUserKey(null);
        thread.setResolvedByName(null);
        thread.setUpdatedAt(now());
        threadRepository.save(thread);
    }

    @Transactional
    public void addReaction(UUID callerId, UUID documentId, UUID threadId, UUID commentId, String emoji) {
        Caller caller = resolveCaller(callerId, documentId);
        CommentThread thread = requireThread(documentId, threadId);
        Comment comment = requireComment(thread, commentId);
        if (caller.isAnonymous()) {
            throw new ApiException(ErrorCode.FORBIDDEN, "Sign in to react to comments.");
        }

        String normalizedEmoji = normalizeEmoji(emoji);
        if (reactionRepository
                .findByComment_IdAndUser_IdAndEmoji(commentId, caller.userId(), normalizedEmoji)
                .isPresent()) {
            throw new ApiException(ErrorCode.CONFLICT, "You already reacted with this emoji.");
        }

        CommentReaction reaction = CommentReaction.builder()
                .id(UUID.randomUUID())
                .comment(comment)
                .user(caller.user())
                .emoji(normalizedEmoji)
                .createdAt(now())
                .build();
        try {
            // Flush here so a double-click that passed the existence check turns into
            // the documented conflict instead of a 500 after the transaction commits.
            reactionRepository.saveAndFlush(reaction);
        } catch (DataIntegrityViolationException ex) {
            throw new ApiException(ErrorCode.CONFLICT, "You already reacted with this emoji.");
        }
        touchThread(thread);
    }

    @Transactional
    public void removeReaction(UUID callerId, UUID documentId, UUID threadId, UUID commentId, String emoji) {
        Caller caller = resolveCaller(callerId, documentId);
        CommentThread thread = requireThread(documentId, threadId);
        requireComment(thread, commentId);
        if (caller.isAnonymous()) {
            throw new ApiException(ErrorCode.FORBIDDEN, "Sign in to react to comments.");
        }

        CommentReaction reaction = reactionRepository
                .findByComment_IdAndUser_IdAndEmoji(commentId, caller.userId(), normalizeEmoji(emoji))
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
        reactionRepository.delete(reaction);
        touchThread(thread);
    }

    // --- access -----------------------------------------------------------------

    private Caller resolveCaller(UUID userId, UUID documentId) {
        if (userId == null) {
            PermissionService.DocumentCommentAccess access = permissionService.requirePublicCommentAccess(documentId);
            return new Caller(null, null, GUEST_NAME, access.document(), access.accessLevel());
        }

        PermissionService.DocumentCommentAccess access = permissionService.requireCommentAccess(userId, documentId);
        // The JWT filter re-reads the account on every request, so this cannot be a
        // stale session; the lookup is here because the author snapshot needs the name.
        User user = userRepository.findById(userId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
        return new Caller(userId, user, user.getDisplayName(), access.document(), access.accessLevel());
    }

    private CommentThread requireThread(UUID documentId, UUID threadId) {
        return threadRepository
                .findByIdAndDocument_Id(threadId, documentId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
    }

    private Comment requireComment(CommentThread thread, UUID commentId) {
        return commentRepository
                .findByIdAndThread_Id(commentId, thread.getId())
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
    }

    // --- serialization ----------------------------------------------------------

    private List<ThreadResponse> toThreadResponses(Caller caller, List<CommentThread> threads) {
        if (threads.isEmpty()) {
            return List.of();
        }

        List<UUID> threadIds = threads.stream().map(CommentThread::getId).toList();
        List<Comment> comments = commentRepository.findAllByThread_IdInOrderByCreatedAtAscIdAsc(threadIds);
        List<CommentReaction> reactions = comments.isEmpty()
                ? List.of()
                : reactionRepository.findAllByComment_IdIn(
                        comments.stream().map(Comment::getId).toList());

        Map<UUID, List<Comment>> commentsByThread = new LinkedHashMap<>();
        for (Comment comment : comments) {
            commentsByThread
                    .computeIfAbsent(comment.getThread().getId(), key -> new ArrayList<>())
                    .add(comment);
        }

        Map<UUID, List<CommentReaction>> reactionsByComment = new LinkedHashMap<>();
        for (CommentReaction reaction : reactions) {
            reactionsByComment
                    .computeIfAbsent(reaction.getComment().getId(), key -> new ArrayList<>())
                    .add(reaction);
        }

        return threads.stream()
                .map(thread -> toThreadResponse(
                        caller, thread, commentsByThread.getOrDefault(thread.getId(), List.of()), reactionsByComment))
                .toList();
    }

    private ThreadResponse toThreadResponse(
            Caller caller,
            CommentThread thread,
            List<Comment> comments,
            Map<UUID, List<CommentReaction>> reactionsByComment) {
        List<CommentResponse> replies = comments.stream()
                .map(comment ->
                        toCommentResponse(caller, comment, reactionsByComment.getOrDefault(comment.getId(), List.of())))
                .toList();

        return new ThreadResponse(
                thread.getId(),
                thread.getCreatedAt(),
                thread.getUpdatedAt(),
                thread.isResolved(),
                thread.getResolvedAt(),
                resolvedByOf(thread),
                replies,
                new ThreadAbilitiesResponse(!caller.isAnonymous() && caller.canEdit(), true, true));
    }

    private CommentResponse toCommentResponse(Caller caller, Comment comment, List<CommentReaction> reactions) {
        return new CommentResponse(
                comment.getId(),
                authorOf(comment),
                parseBody(comment.getBody()),
                comment.getCreatedAt(),
                comment.getUpdatedAt(),
                aggregateReactions(reactions),
                new CommentAbilitiesResponse(
                        caller.isAuthor(comment),
                        !caller.isAnonymous() && (caller.isAuthor(comment) || caller.canEdit()),
                        !caller.isAnonymous()));
    }

    private CommentAuthorResponse authorOf(Comment comment) {
        User author = comment.getAuthor();
        if (author != null) {
            return new CommentAuthorResponse(author.getId(), author.getDisplayName(), author.getAvatarUrl());
        }
        // The FK is nulled when an account is deleted; the recorded key and name
        // keep the comment attributed instead of collapsing it into "Guest".
        return new CommentAuthorResponse(comment.getAuthorUserKey(), comment.getAuthorName(), null);
    }

    private CommentAuthorResponse resolvedByOf(CommentThread thread) {
        if (!thread.isResolved()) {
            return null;
        }
        User resolvedBy = thread.getResolvedBy();
        if (resolvedBy != null) {
            return new CommentAuthorResponse(
                    resolvedBy.getId(), resolvedBy.getDisplayName(), resolvedBy.getAvatarUrl());
        }
        String name = thread.getResolvedByName() != null ? thread.getResolvedByName() : GUEST_NAME;
        return new CommentAuthorResponse(thread.getResolvedByUserKey(), name, null);
    }

    private List<CommentReactionResponse> aggregateReactions(List<CommentReaction> reactions) {
        if (reactions.isEmpty()) {
            return List.of();
        }

        List<CommentReaction> ordered = reactions.stream()
                .sorted(Comparator.comparing(CommentReaction::getCreatedAt)
                        .thenComparing(reaction -> reaction.getUser().getId()))
                .toList();

        Map<String, List<CommentReaction>> byEmoji = new LinkedHashMap<>();
        for (CommentReaction reaction : ordered) {
            byEmoji.computeIfAbsent(reaction.getEmoji(), key -> new ArrayList<>())
                    .add(reaction);
        }

        return byEmoji.entrySet().stream()
                .map(entry -> {
                    List<CommentReaction> group = entry.getValue();
                    return new CommentReactionResponse(
                            entry.getKey(),
                            group.getFirst().getCreatedAt(),
                            group.stream()
                                    .map(reaction -> new CommentAuthorResponse(
                                            reaction.getUser().getId(),
                                            reaction.getUser().getDisplayName(),
                                            reaction.getUser().getAvatarUrl()))
                                    .toList());
                })
                .toList();
    }

    // --- validation -------------------------------------------------------------

    private String normalizeBody(JsonNode body) {
        if (body == null || !body.isArray() || body.isEmpty()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Comment body must be a non-empty array of blocks.");
        }
        for (JsonNode element : body) {
            if (element == null || !element.isObject()) {
                throw new ApiException(
                        ErrorCode.VALIDATION_FAILED, "Comment body must be a non-empty array of blocks.");
            }
        }

        byte[] json;
        try {
            json = objectMapper.writeValueAsBytes(body);
        } catch (RuntimeException ex) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Comment body is not valid JSON.");
        }
        if (json.length > MAX_BODY_BYTES) {
            throw new ApiException(
                    ErrorCode.VALIDATION_FAILED, "Comment body must be at most " + (MAX_BODY_BYTES / 1024) + " KB.");
        }
        return new String(json, StandardCharsets.UTF_8);
    }

    private JsonNode parseBody(String body) {
        try {
            return objectMapper.readTree(body);
        } catch (RuntimeException ex) {
            // A stored body was validated on write; reaching this means the row was
            // modified outside the API, which is a server fault rather than a 400.
            log.error("Stored comment body is not valid JSON", ex);
            throw new ApiException(ErrorCode.INTERNAL_ERROR);
        }
    }

    private static String truncate(String value, int maxLength) {
        return value == null || value.length() <= maxLength ? value : value.substring(0, maxLength);
    }

    private static String normalizeEmoji(String emoji) {
        String value = emoji == null ? "" : emoji.strip();
        if (value.isEmpty() || value.length() > 64 || value.contains("/")) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "emoji must be 1-64 characters.");
        }
        return value;
    }

    private void touchThread(CommentThread thread) {
        thread.setUpdatedAt(now());
        threadRepository.save(thread);
    }

    private static OffsetDateTime now() {
        return OffsetDateTime.now(ZoneOffset.UTC);
    }
}
