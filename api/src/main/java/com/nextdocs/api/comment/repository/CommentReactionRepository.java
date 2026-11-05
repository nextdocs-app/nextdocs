package com.nextdocs.api.comment.repository;

import com.nextdocs.api.comment.entity.CommentReaction;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CommentReactionRepository extends JpaRepository<CommentReaction, UUID> {

    /** Every reaction on a page of comments, with the reactor for the avatar stack. */
    @EntityGraph(attributePaths = {"user"})
    List<CommentReaction> findAllByComment_IdIn(Collection<UUID> commentIds);

    Optional<CommentReaction> findByComment_IdAndUser_IdAndEmoji(UUID commentId, UUID userId, String emoji);

    /**
     * Bulk delete used by the document purge. Reactions go before comments so the
     * H2 test schema never sees a dangling foreign key.
     */
    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM CommentReaction r WHERE r.comment.id IN "
            + "(SELECT c.id FROM Comment c WHERE c.thread.document.id IN :documentIds)")
    int deleteByDocumentIds(@Param("documentIds") Collection<UUID> documentIds);
}
