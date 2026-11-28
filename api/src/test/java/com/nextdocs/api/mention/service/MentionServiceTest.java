package com.nextdocs.api.mention.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.nextdocs.api.comment.entity.Comment;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.service.PermissionService;
import com.nextdocs.api.mention.entity.CommentMention;
import com.nextdocs.api.mention.entity.DocumentMention;
import com.nextdocs.api.mention.repository.CommentMentionRepository;
import com.nextdocs.api.mention.repository.DocumentMentionRepository;
import com.nextdocs.api.mention.repository.DocumentMentionVersionRepository;
import com.nextdocs.api.realtime.dto.request.ContentUpdatedRequest;
import com.nextdocs.api.user.entity.User;
import com.nextdocs.api.user.repository.UserRepository;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@ExtendWith(MockitoExtension.class)
class MentionServiceTest {

    @Mock
    private CommentMentionRepository commentMentionRepository;

    @Mock
    private DocumentMentionRepository documentMentionRepository;

    @Mock
    private DocumentMentionVersionRepository documentMentionVersionRepository;

    @Mock
    private UserRepository userRepository;

    @Mock
    private PermissionService permissionService;

    @Mock
    private DocumentRepository documentRepository;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private static final Instant PRODUCED_AT = Instant.parse("2026-01-01T00:00:00Z");

    private MentionService mentionService;

    private UUID documentId;
    private UUID actorId;
    private UUID bobId;
    private UUID daveId;
    private UUID charlieId;
    private User actor;
    private User bob;
    private User dave;
    private User charlie;
    private Document document;
    private Comment comment;

    @BeforeEach
    void setUp() {
        mentionService = new MentionService(
                commentMentionRepository,
                documentMentionRepository,
                documentMentionVersionRepository,
                userRepository,
                permissionService,
                documentRepository);

        documentId = UUID.randomUUID();
        actorId = UUID.randomUUID();
        bobId = UUID.randomUUID();
        daveId = UUID.randomUUID();
        charlieId = UUID.randomUUID();
        actor = user(actorId, "Alice");
        bob = user(bobId, "Bob");
        dave = user(daveId, "Dave");
        charlie = user(charlieId, "Charlie");
        document = Document.builder().id(documentId).title("Doc").build();
        comment = Comment.builder().id(UUID.randomUUID()).build();
        // The mark starts free; tests that care about ordering stub the rejection instead.
        lenient().when(documentMentionVersionRepository.claim(any(), any())).thenReturn(true);
    }

    @Test
    void commentReconcileKeepsUnchangedRowsAndOnlyInsertsNewAllowedMentions() throws Exception {
        JsonNode body = commentBody(actorId, bobId, daveId, charlieId);
        // The self-mention is removed before the lookup, so the repository returns the
        // remaining people only.
        when(userRepository.findAllById(any())).thenReturn(List.of(bob, dave, charlie));
        when(permissionService.resolveAccessForUsers(eq(documentId), any(), eq(false)))
                .thenReturn(access(
                        actorId, DocumentAccessLevel.COMMENT,
                        bobId, DocumentAccessLevel.VIEW,
                        daveId, DocumentAccessLevel.EDIT,
                        charlieId, null));

        OffsetDateTime notifiedAt = OffsetDateTime.now();
        CommentMention bobExisting = commentMention(comment, bob, notifiedAt);
        CommentMention charlieExisting = commentMention(comment, charlie, null);
        when(commentMentionRepository.findAllByComment_Id(comment.getId()))
                .thenReturn(List.of(bobExisting, charlieExisting));

        mentionService.reconcileCommentMentions(comment, document, actor, body);

        // Charlie lost access, so his row goes. Bob was already mentioned and keeps his
        // notifiedAt: an edit that leaves a mention in place must not notify twice.
        List<CommentMention> deleted = commentDeletes();
        assertEquals(List.of(charlieExisting), deleted);

        // Dave is new; the actor's self-mention is not a notification.
        List<CommentMention> inserted = commentInserts();
        assertEquals(1, inserted.size());
        assertEquals(daveId, inserted.getFirst().getMentionedUser().getId());
        assertEquals(actorId, inserted.getFirst().getMentionedByUser().getId());
        assertNull(inserted.getFirst().getNotifiedAt());
    }

    @Test
    void anonymousCommentNeverCreatesMentionRows() throws Exception {
        mentionService.reconcileCommentMentions(comment, document, null, commentBody(bobId));

        verifyNoInteractions(commentMentionRepository, userRepository, permissionService);
    }

    @Test
    void documentReconcileInsertsNewMentionsAsPending() {
        when(documentRepository.findById(documentId)).thenReturn(Optional.of(document));
        when(userRepository.findAllById(any())).thenReturn(List.of(bob, dave, charlie));
        when(permissionService.resolveAccessForUsers(eq(documentId), any(), eq(false)))
                .thenReturn(access(
                        bobId, DocumentAccessLevel.VIEW,
                        daveId, DocumentAccessLevel.EDIT,
                        charlieId, null));

        DocumentMention bobExisting = documentMention(bob, OffsetDateTime.now());
        DocumentMention charlieExisting = documentMention(charlie, null);
        when(documentMentionRepository.findAllByDocument_Id(documentId))
                .thenReturn(List.of(bobExisting, charlieExisting));

        mentionService.reconcileDocumentMentions(documentId, refs(bobId, daveId, charlieId), false, PRODUCED_AT);

        List<DocumentMention> deleted = documentDeletes();
        assertEquals(List.of(charlieExisting), deleted);

        List<DocumentMention> inserted = documentInserts();
        assertEquals(1, inserted.size());
        assertEquals(daveId, inserted.getFirst().getMentionedUser().getId());
        assertNull(inserted.getFirst().getNotifiedAt());
    }

    @Test
    void documentReindexRepairsTheSetButDoesNotQueueNotifications() {
        when(documentRepository.findById(documentId)).thenReturn(Optional.of(document));
        when(userRepository.findAllById(any())).thenReturn(List.of(dave));
        when(permissionService.resolveAccessForUsers(eq(documentId), any(), eq(false)))
                .thenReturn(access(daveId, DocumentAccessLevel.EDIT));
        when(documentMentionRepository.findAllByDocument_Id(documentId)).thenReturn(List.of());

        mentionService.reconcileDocumentMentions(documentId, refs(daveId), true, PRODUCED_AT);

        List<DocumentMention> inserted = documentInserts();
        assertEquals(1, inserted.size());
        assertNotNull(inserted.getFirst().getNotifiedAt());
    }

    @Test
    void documentMentionsOnAnAnonymousEditablePageAreIndexedButNeverQueued() {
        // An EDIT share link lets anyone with the URL write the Y.Doc, and the compaction
        // callback carries no actor. The set is still indexed, but the pending queue (the
        // notification seam) must not accept rows nobody can be held responsible for.
        when(documentRepository.findById(documentId)).thenReturn(Optional.of(document));
        when(userRepository.findAllById(any())).thenReturn(List.of(bob));
        when(permissionService.resolveAccessForUsers(eq(documentId), any(), eq(false)))
                .thenReturn(access(bobId, DocumentAccessLevel.VIEW));
        when(permissionService.resolvePublicAccess(documentId)).thenReturn(DocumentAccessLevel.EDIT);
        when(documentMentionRepository.findAllByDocument_Id(documentId)).thenReturn(List.of());

        mentionService.reconcileDocumentMentions(documentId, refs(bobId), false, PRODUCED_AT);

        List<DocumentMention> inserted = documentInserts();
        assertEquals(1, inserted.size());
        assertNotNull(inserted.getFirst().getNotifiedAt());
    }

    @Test
    void documentReconcileDoesNothingWhenMentionsAreUnknown() {
        mentionService.reconcileDocumentMentions(documentId, null, false, PRODUCED_AT);

        verifyNoInteractions(commentMentionRepository, documentMentionRepository, userRepository, permissionService);
    }

    @Test
    void inactiveUsersAreNeverMentioned() {
        bob.setActive(false);
        when(documentRepository.findById(documentId)).thenReturn(Optional.of(document));
        when(userRepository.findAllById(any())).thenReturn(List.of(bob));
        when(documentMentionRepository.findAllByDocument_Id(documentId)).thenReturn(List.of());

        mentionService.reconcileDocumentMentions(documentId, refs(bobId), false, PRODUCED_AT);

        verifyNoInteractions(commentMentionRepository);
    }

    @Test
    void commentReconcileLeavesAnUnchangedMentionSetUntouched() throws Exception {
        when(userRepository.findAllById(any())).thenReturn(List.of(bob));
        when(permissionService.resolveAccessForUsers(eq(documentId), any(), eq(false)))
                .thenReturn(access(bobId, DocumentAccessLevel.VIEW));
        CommentMention existing = commentMention(comment, bob, OffsetDateTime.now());
        when(commentMentionRepository.findAllByComment_Id(comment.getId())).thenReturn(List.of(existing));

        mentionService.reconcileCommentMentions(comment, document, actor, commentBody(bobId));

        // Bob is still allowed and already mentioned: no delete and no re-insert, so his
        // pending/notified state survives an edit that leaves the mention in place.
        verify(commentMentionRepository, never()).deleteAll(any());
        verify(commentMentionRepository, never()).saveAll(any());
    }

    @Test
    void documentReconcileIgnoresAMissingDocument() {
        when(documentRepository.findById(documentId)).thenReturn(Optional.empty());

        mentionService.reconcileDocumentMentions(documentId, refs(bobId), false, PRODUCED_AT);

        verifyNoInteractions(documentMentionRepository, userRepository, permissionService);
    }

    @Test
    void documentReconcileIgnoresNullEntriesAndNullUserIds() {
        List<ContentUpdatedRequest.MentionRef> mentions = new ArrayList<>();
        mentions.add(null);
        mentions.add(new ContentUpdatedRequest.MentionRef(null));
        mentions.add(new ContentUpdatedRequest.MentionRef(bobId));
        when(documentRepository.findById(documentId)).thenReturn(Optional.of(document));
        when(userRepository.findAllById(any())).thenReturn(List.of(bob));
        when(permissionService.resolveAccessForUsers(eq(documentId), any(), eq(false)))
                .thenReturn(access(bobId, DocumentAccessLevel.VIEW));
        when(permissionService.resolvePublicAccess(documentId)).thenReturn(null);
        when(documentMentionRepository.findAllByDocument_Id(documentId)).thenReturn(List.of());

        mentionService.reconcileDocumentMentions(documentId, mentions, false, PRODUCED_AT);

        List<DocumentMention> inserted = documentInserts();
        assertEquals(1, inserted.size());
        assertEquals(bobId, inserted.getFirst().getMentionedUser().getId());
    }

    @Test
    void documentReconcileWithNoMentionsSkipsTheUserLookup() {
        when(documentRepository.findById(documentId)).thenReturn(Optional.of(document));
        when(permissionService.resolvePublicAccess(documentId)).thenReturn(null);
        when(documentMentionRepository.findAllByDocument_Id(documentId)).thenReturn(List.of());

        mentionService.reconcileDocumentMentions(documentId, List.of(), false, PRODUCED_AT);

        // An empty mention set is a real clear, but there is nobody to look up and
        // nothing to insert.
        verifyNoInteractions(userRepository);
        verify(documentMentionRepository, never()).deleteAll(any());
        verify(documentMentionRepository, never()).saveAll(any());
    }

    @Test
    void documentReconcileQueuesWhenTheShareLinkCannotEdit() {
        when(documentRepository.findById(documentId)).thenReturn(Optional.of(document));
        when(userRepository.findAllById(any())).thenReturn(List.of(bob));
        when(permissionService.resolveAccessForUsers(eq(documentId), any(), eq(false)))
                .thenReturn(access(bobId, DocumentAccessLevel.VIEW));
        // A VIEW link does not make the body anonymously writable, so the mention still
        // has an attributable edit and can be queued.
        when(permissionService.resolvePublicAccess(documentId)).thenReturn(DocumentAccessLevel.VIEW);
        when(documentMentionRepository.findAllByDocument_Id(documentId)).thenReturn(List.of());

        mentionService.reconcileDocumentMentions(documentId, refs(bobId), false, PRODUCED_AT);

        List<DocumentMention> inserted = documentInserts();
        assertEquals(1, inserted.size());
        assertNull(inserted.getFirst().getNotifiedAt());
    }

    @Test
    void documentReconcileDropsASetOlderThanTheOneAlreadyIndexed() {
        when(documentRepository.findById(documentId)).thenReturn(Optional.of(document));
        // A newer read already owns the mention index: applying this older set would
        // restore a mention that body removed and queue a cancelled notification.
        when(documentMentionVersionRepository.claim(eq(documentId), any())).thenReturn(false);

        mentionService.reconcileDocumentMentions(documentId, refs(bobId), false, PRODUCED_AT);

        verify(documentMentionVersionRepository)
                .claim(documentId, OffsetDateTime.ofInstant(PRODUCED_AT, ZoneOffset.UTC));
        verifyNoInteractions(userRepository, permissionService);
        verify(documentMentionRepository, never()).deleteAll(any());
        verify(documentMentionRepository, never()).saveAll(any());
    }

    @Test
    void documentReconcileStampsARetainedPendingMentionOnAnAnonymousEditablePage() {
        // The row was queued while the page had an attributable author; an EDIT link now
        // lets anyone holding the URL write the body, so it can no longer be delivered.
        when(documentRepository.findById(documentId)).thenReturn(Optional.of(document));
        when(userRepository.findAllById(any())).thenReturn(List.of(bob));
        when(permissionService.resolveAccessForUsers(eq(documentId), any(), eq(false)))
                .thenReturn(access(bobId, DocumentAccessLevel.VIEW));
        when(permissionService.resolvePublicAccess(documentId)).thenReturn(DocumentAccessLevel.EDIT);
        DocumentMention pending = documentMention(bob, null);
        when(documentMentionRepository.findAllByDocument_Id(documentId)).thenReturn(List.of(pending));

        mentionService.reconcileDocumentMentions(documentId, refs(bobId), true, PRODUCED_AT);

        assertNotNull(pending.getNotifiedAt());
        verify(documentMentionRepository).saveAll(List.of(pending));
        verify(documentMentionRepository, never()).deleteAll(any());
    }

    @Test
    void documentReindexKeepsAPendingMentionPending() {
        // A repair crawl re-reads the same content: the author did not change, so the
        // notification must survive the reindex.
        when(documentRepository.findById(documentId)).thenReturn(Optional.of(document));
        when(userRepository.findAllById(any())).thenReturn(List.of(bob));
        when(permissionService.resolveAccessForUsers(eq(documentId), any(), eq(false)))
                .thenReturn(access(bobId, DocumentAccessLevel.VIEW));
        when(permissionService.resolvePublicAccess(documentId)).thenReturn(null);
        DocumentMention pending = documentMention(bob, null);
        when(documentMentionRepository.findAllByDocument_Id(documentId)).thenReturn(List.of(pending));

        mentionService.reconcileDocumentMentions(documentId, refs(bobId), true, PRODUCED_AT);

        assertNull(pending.getNotifiedAt());
        verify(documentMentionRepository, never()).saveAll(any());
    }

    private JsonNode commentBody(UUID... userIds) throws Exception {
        StringBuilder content = new StringBuilder("[");
        for (int i = 0; i < userIds.length; i++) {
            if (i > 0) {
                content.append(',');
            }
            content.append("{\"type\":\"mention\",\"props\":{\"userId\":\"")
                    .append(userIds[i])
                    .append("\",\"label\":\"Person\"}}");
        }
        content.append(']');
        return objectMapper.readTree("[{\"type\":\"paragraph\",\"content\":" + content + "}]");
    }

    private static List<ContentUpdatedRequest.MentionRef> refs(UUID... userIds) {
        List<ContentUpdatedRequest.MentionRef> refs = new ArrayList<>();
        for (UUID userId : userIds) {
            refs.add(new ContentUpdatedRequest.MentionRef(userId));
        }
        return refs;
    }

    private static User user(UUID id, String name) {
        return User.builder()
                .id(id)
                .email(name.toLowerCase() + "@example.com")
                .displayName(name)
                .passwordHash("$2a$12$hash")
                .active(true)
                .build();
    }

    private static Map<UUID, DocumentAccessLevel> access(Object... pairs) {
        Map<UUID, DocumentAccessLevel> access = new HashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            access.put((UUID) pairs[i], (DocumentAccessLevel) pairs[i + 1]);
        }
        return access;
    }

    private static CommentMention commentMention(Comment comment, User user, OffsetDateTime notifiedAt) {
        return CommentMention.builder()
                .id(UUID.randomUUID())
                .comment(comment)
                .mentionedUser(user)
                .createdAt(OffsetDateTime.now())
                .notifiedAt(notifiedAt)
                .build();
    }

    private static DocumentMention documentMention(User user, OffsetDateTime notifiedAt) {
        return DocumentMention.builder()
                .id(UUID.randomUUID())
                .mentionedUser(user)
                .createdAt(OffsetDateTime.now())
                .notifiedAt(notifiedAt)
                .build();
    }

    @SuppressWarnings("unchecked")
    private List<CommentMention> commentDeletes() {
        ArgumentCaptor<Iterable<CommentMention>> captor = ArgumentCaptor.forClass(Iterable.class);
        verify(commentMentionRepository).deleteAll(captor.capture());
        return toList(captor.getValue());
    }

    @SuppressWarnings("unchecked")
    private List<CommentMention> commentInserts() {
        ArgumentCaptor<Iterable<CommentMention>> captor = ArgumentCaptor.forClass(Iterable.class);
        verify(commentMentionRepository).saveAll(captor.capture());
        return toList(captor.getValue());
    }

    @SuppressWarnings("unchecked")
    private List<DocumentMention> documentDeletes() {
        ArgumentCaptor<Iterable<DocumentMention>> captor = ArgumentCaptor.forClass(Iterable.class);
        verify(documentMentionRepository).deleteAll(captor.capture());
        return toList(captor.getValue());
    }

    @SuppressWarnings("unchecked")
    private List<DocumentMention> documentInserts() {
        ArgumentCaptor<Iterable<DocumentMention>> captor = ArgumentCaptor.forClass(Iterable.class);
        verify(documentMentionRepository).saveAll(captor.capture());
        return toList(captor.getValue());
    }

    private static <T> List<T> toList(Iterable<T> values) {
        List<T> list = new ArrayList<>();
        values.forEach(list::add);
        return list;
    }
}
