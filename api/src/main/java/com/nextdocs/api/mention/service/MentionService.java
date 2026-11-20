package com.nextdocs.api.mention.service;

import com.nextdocs.api.comment.entity.Comment;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.service.PermissionService;
import com.nextdocs.api.mention.entity.CommentMention;
import com.nextdocs.api.mention.entity.DocumentMention;
import com.nextdocs.api.mention.repository.CommentMentionRepository;
import com.nextdocs.api.mention.repository.DocumentMentionRepository;
import com.nextdocs.api.mention.util.CommentMentionExtractor;
import com.nextdocs.api.realtime.dto.request.ContentUpdatedRequest;
import com.nextdocs.api.user.entity.User;
import com.nextdocs.api.user.repository.UserRepository;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;

/**
 * Keeps the mention indexes in step with the two content sources.
 *
 * <p>Neither source is rewritten here: comment bodies remain JSON in {@code comments}
 * and document bodies remain the Yhub Y.Doc. These rows are a projection used by the
 * future notifier, and the access check on write is what stops a forged mention from
 * notifying someone who cannot open the page. Delivery re-checks access because a
 * grant may be revoked between the mention and the notification.
 */
@Service
@RequiredArgsConstructor
public class MentionService {

    private final CommentMentionRepository commentMentionRepository;
    private final DocumentMentionRepository documentMentionRepository;
    private final UserRepository userRepository;
    private final PermissionService permissionService;
    private final DocumentRepository documentRepository;

    /**
     * Reconciles the mentions of one comment. Runs in the comment write's transaction,
     * so a failed mention index rolls the comment back rather than leaving an
     * un-notifiable body.
     *
     * <p>Anonymous comments are ignored: they have no author to attribute and letting a
     * share-link guest enqueue notifications would be a spam channel.
     */
    @Transactional
    public void reconcileCommentMentions(Comment comment, Document document, User actor, JsonNode body) {
        if (actor == null) {
            return;
        }

        Set<UUID> mentionedIds = CommentMentionExtractor.extractUserIds(body);
        mentionedIds.remove(actor.getId());

        Map<UUID, User> users = activeUsers(mentionedIds);
        Set<UUID> allowedIds = allowedUsers(document.getId(), users.keySet());
        List<CommentMention> existing = commentMentionRepository.findAllByComment_Id(comment.getId());

        Map<UUID, CommentMention> existingByUser = new HashMap<>();
        List<CommentMention> toDelete = new ArrayList<>();
        for (CommentMention mention : existing) {
            UUID userId = mention.getMentionedUser().getId();
            if (!allowedIds.contains(userId)) {
                toDelete.add(mention);
            } else {
                existingByUser.put(userId, mention);
            }
        }

        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        List<CommentMention> toInsert = new ArrayList<>();
        for (UUID userId : allowedIds) {
            if (existingByUser.containsKey(userId)) {
                // Keep the old row (and its notifiedAt): an edit that leaves a mention
                // in place must not notify the same person twice.
                continue;
            }
            toInsert.add(CommentMention.builder()
                    .id(UUID.randomUUID())
                    .comment(comment)
                    .document(document)
                    .mentionedUser(users.get(userId))
                    .mentionedByUser(actor)
                    .createdAt(now)
                    .build());
        }

        if (!toDelete.isEmpty()) {
            commentMentionRepository.deleteAll(toDelete);
        }
        if (!toInsert.isEmpty()) {
            commentMentionRepository.saveAll(toInsert);
        }
    }

    /**
     * Reconciles the current mention set of one document from realtime's extraction.
     *
     * <p>{@code mentions == null} means the sender could not extract them (older
     * realtime build or a failed walk): leave the index untouched rather than treating
     * it as "no mentions". An empty list is a real clear. A search reindex repairs the
     * set but stamps the new rows as already notified, because a repair crawl is not an
     * edit and must not re-notify every mention every day.
     *
     * <p>Row sponsorship is unverifiable here: the compaction callback carries no actor,
     * and an EDIT-level share link lets anyone holding the URL write the Y.Doc (realtime
     * grants {@code ydoc: '-ru-'} to the link level). A page in that state still gets its
     * set indexed, but every row is stamped as already notified. That gives up member
     * notifications on link-editable pages until an editing identity reaches this
     * callback; the alternative is a queue anyone with the URL can write into.
     */
    @Transactional
    public void reconcileDocumentMentions(
            UUID documentId, List<ContentUpdatedRequest.MentionRef> mentions, boolean reindex) {
        if (mentions == null) {
            return;
        }

        Document document = documentRepository.findById(documentId).orElse(null);
        if (document == null) {
            return;
        }

        Set<UUID> mentionedIds = new LinkedHashSet<>();
        for (ContentUpdatedRequest.MentionRef mention : mentions) {
            if (mention != null && mention.userId() != null) {
                mentionedIds.add(mention.userId());
            }
        }

        // A reindex repair is not an edit, and an anonymously writable body has no author
        // to attribute: neither may queue a notification.
        boolean queueNotifications = !reindex && !allowsAnonymousEdit(documentId);

        Map<UUID, User> users = activeUsers(mentionedIds);
        Set<UUID> allowedIds = allowedUsers(documentId, users.keySet());
        List<DocumentMention> existing = documentMentionRepository.findAllByDocument_Id(documentId);

        Map<UUID, DocumentMention> existingByUser = new HashMap<>();
        List<DocumentMention> toDelete = new ArrayList<>();
        for (DocumentMention mention : existing) {
            UUID userId = mention.getMentionedUser().getId();
            if (!allowedIds.contains(userId)) {
                toDelete.add(mention);
            } else {
                existingByUser.put(userId, mention);
            }
        }

        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        List<DocumentMention> toInsert = new ArrayList<>();
        for (UUID userId : allowedIds) {
            if (existingByUser.containsKey(userId)) {
                continue;
            }
            toInsert.add(DocumentMention.builder()
                    .id(UUID.randomUUID())
                    .document(document)
                    .mentionedUser(users.get(userId))
                    .createdAt(now)
                    .notifiedAt(queueNotifications ? null : now)
                    .build());
        }

        if (!toDelete.isEmpty()) {
            documentMentionRepository.deleteAll(toDelete);
        }
        if (!toInsert.isEmpty()) {
            documentMentionRepository.saveAll(toInsert);
        }
    }

    /** An EDIT share link makes the Y.Doc writable by anyone holding the URL, anonymously. */
    private boolean allowsAnonymousEdit(UUID documentId) {
        DocumentAccessLevel link = permissionService.resolvePublicAccess(documentId);
        return link != null && link.allowsEdit();
    }

    /** Active accounts only: a removed member must not accumulate pending notifications. */
    private Map<UUID, User> activeUsers(Set<UUID> ids) {
        if (ids.isEmpty()) {
            return Map.of();
        }
        Map<UUID, User> users = new HashMap<>();
        for (User user : userRepository.findAllById(ids)) {
            if (user.isActive()) {
                users.put(user.getId(), user);
            }
        }
        return users;
    }

    /**
     * The identity channel only: a person reachable solely through a public link is not
     * a notification recipient. `resolveAccessForUsers` returns a key with a null level
     * for a blocked user, so presence alone is not enough.
     */
    private Set<UUID> allowedUsers(UUID documentId, Set<UUID> userIds) {
        if (userIds.isEmpty()) {
            return Set.of();
        }
        Map<UUID, DocumentAccessLevel> access = permissionService.resolveAccessForUsers(documentId, userIds, false);
        Set<UUID> allowed = new LinkedHashSet<>();
        for (UUID userId : userIds) {
            if (access.get(userId) != null) {
                allowed.add(userId);
            }
        }
        return allowed;
    }
}
