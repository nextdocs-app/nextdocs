package com.nextdocs.api.comment.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.comment.entity.Comment;
import com.nextdocs.api.comment.entity.CommentReaction;
import com.nextdocs.api.comment.entity.CommentThread;
import com.nextdocs.api.comment.service.CommentCleanup;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.repository.DocumentRepository;
import jakarta.persistence.EntityManager;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.annotation.Transactional;

/**
 * Entity mapping, ordering, cascade, and purge coverage for comment rows. The test
 * schema is built by Hibernate on H2 (Flyway is disabled); the entities declare
 * ON DELETE CASCADE so the generated FKs match the Postgres migration and the
 * database performs the cascades in both environments.
 */
@SpringBootTest
@Transactional
class CommentPersistenceTest {

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private DocumentRepository documentRepository;

    @Autowired
    private CommentThreadRepository threadRepository;

    @Autowired
    private CommentRepository commentRepository;

    @Autowired
    private CommentReactionRepository reactionRepository;

    @Autowired
    private CommentCleanup commentCleanup;

    @Autowired
    private EntityManager entityManager;

    private User user;
    private Document document;

    @BeforeEach
    void setUp() {
        user = userRepository.saveAndFlush(
                User.builder().email("alice@example.com").displayName("Alice").build());
        document = documentRepository.saveAndFlush(Document.builder()
                .id(UUID.randomUUID())
                .user(user)
                .title("Document")
                .yjsState("seed".getBytes(StandardCharsets.UTF_8))
                .build());
    }

    @Test
    void explicitIds_surviveRepositoryInsert() {
        // The legacy importer supplies the original thread/comment ids; the editor's
        // existing comment marks reference them, so Hibernate must not replace them.
        UUID threadId = UUID.randomUUID();
        UUID commentId = UUID.randomUUID();
        OffsetDateTime created = now().minusDays(1);

        CommentThread thread = threadRepository.saveAndFlush(CommentThread.builder()
                .id(threadId)
                .document(document)
                .createdBy(user)
                .createdAt(created)
                .updatedAt(created)
                .build());
        commentRepository.saveAndFlush(Comment.builder()
                .id(commentId)
                .thread(thread)
                .author(user)
                .authorUserKey(user.getId())
                .authorName(user.getDisplayName())
                .body("[{\"type\":\"paragraph\"}]")
                .createdAt(created)
                .updatedAt(created)
                .build());

        entityManager.clear();

        assertThat(threadRepository.findById(threadId)).isPresent();
        assertThat(commentRepository.findById(commentId)).isPresent();
    }

    @Test
    void comments_areListedInCreationOrder() {
        CommentThread thread = saveThread("[{\"type\":\"paragraph\"}]", "[{\"type\":\"paragraph\"}]");
        List<Comment> initial = commentRepository.findAllByThread_IdOrderByCreatedAtAscIdAsc(thread.getId());
        UUID firstId = initial.get(0).getId();
        UUID secondId = initial.get(1).getId();

        setCommentCreatedAt(firstId, now().minusMinutes(1));
        setCommentCreatedAt(secondId, now().minusMinutes(5));
        entityManager.clear();

        List<Comment> comments = commentRepository.findAllByThread_IdOrderByCreatedAtAscIdAsc(thread.getId());
        assertThat(comments).extracting(Comment::getId).containsExactly(secondId, firstId);

        List<Comment> inComments =
                commentRepository.findAllByThread_IdInOrderByCreatedAtAscIdAsc(List.of(thread.getId()));
        assertThat(inComments).extracting(Comment::getId).containsExactly(secondId, firstId);
    }

    @Test
    void findAllByDocument_ordersThreadsByCreation() {
        CommentThread older = saveThread("[]");
        CommentThread newer = saveThread("[]");
        // Creation timestamps can collide at millisecond resolution; pin them so the
        // test checks the query's ordering rather than the clock.
        setThreadCreatedAt(older.getId(), now().minusHours(1));
        setThreadCreatedAt(newer.getId(), now());
        entityManager.clear();

        List<CommentThread> threads = threadRepository.findAllByDocument_IdOrderByCreatedAtAscIdAsc(document.getId());

        assertThat(threads).extracting(CommentThread::getId).containsExactly(older.getId(), newer.getId());
    }

    @Test
    void deleteThread_cascadesCommentsAndReactions() {
        CommentThread thread = saveThread("[]");
        saveReaction(firstCommentOf(thread), "👍");

        threadRepository.delete(thread);
        threadRepository.flush();
        entityManager.clear();

        assertThat(threadRepository.count()).isZero();
        assertThat(commentRepository.count()).isZero();
        assertThat(reactionRepository.count()).isZero();
    }

    @Test
    void reaction_isUniquePerCommentUserAndEmoji() {
        CommentThread thread = saveThread("[]");
        Comment comment = firstCommentOf(thread);
        saveReaction(comment, "👍");

        CommentReaction duplicate = CommentReaction.builder()
                .id(UUID.randomUUID())
                .comment(comment)
                .user(user)
                .emoji("👍")
                .build();

        assertThatThrownBy(() -> reactionRepository.saveAndFlush(duplicate))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void cleanup_removesEveryCommentRowForASubtree() {
        CommentThread thread = saveThread("[]");
        saveReaction(firstCommentOf(thread), "🎉");

        commentCleanup.deleteForDocuments(List.of(document.getId()));
        threadRepository.flush();
        entityManager.clear();

        assertThat(threadRepository.count()).isZero();
        assertThat(commentRepository.count()).isZero();
        assertThat(reactionRepository.count()).isZero();
    }

    private CommentThread saveThread(String... bodies) {
        CommentThread thread = threadRepository.saveAndFlush(CommentThread.builder()
                .id(UUID.randomUUID())
                .document(document)
                .createdBy(user)
                .build());
        for (String body : bodies) {
            commentRepository.saveAndFlush(Comment.builder()
                    .id(UUID.randomUUID())
                    .thread(thread)
                    .author(user)
                    .authorUserKey(user.getId())
                    .authorName(user.getDisplayName())
                    .body(body)
                    .build());
        }
        return thread;
    }

    private Comment firstCommentOf(CommentThread thread) {
        return commentRepository
                .findAllByThread_IdOrderByCreatedAtAscIdAsc(thread.getId())
                .getFirst();
    }

    private void saveReaction(Comment comment, String emoji) {
        reactionRepository.saveAndFlush(CommentReaction.builder()
                .id(UUID.randomUUID())
                .comment(comment)
                .user(user)
                .emoji(emoji)
                .build());
    }

    private void setThreadCreatedAt(UUID threadId, OffsetDateTime createdAt) {
        entityManager
                .createQuery("UPDATE CommentThread t SET t.createdAt = :createdAt WHERE t.id = :id")
                .setParameter("createdAt", createdAt)
                .setParameter("id", threadId)
                .executeUpdate();
    }

    private void setCommentCreatedAt(UUID commentId, OffsetDateTime createdAt) {
        entityManager
                .createQuery("UPDATE Comment c SET c.createdAt = :createdAt WHERE c.id = :id")
                .setParameter("createdAt", createdAt)
                .setParameter("id", commentId)
                .executeUpdate();
    }

    private static OffsetDateTime now() {
        return OffsetDateTime.now(ZoneOffset.UTC);
    }
}
