package com.nextdocs.api.comment.repository;

import com.nextdocs.api.comment.entity.Comment;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CommentRepository extends JpaRepository<Comment, UUID> {

    /** Replies for a page of threads in render order; the author comes along. */
    @EntityGraph(attributePaths = {"author"})
    List<Comment> findAllByThread_IdInOrderByCreatedAtAscIdAsc(Collection<UUID> threadIds);

    @EntityGraph(attributePaths = {"author"})
    List<Comment> findAllByThread_IdOrderByCreatedAtAscIdAsc(UUID threadId);

    Optional<Comment> findByIdAndThread_Id(UUID id, UUID threadId);

    long countByThread_Id(UUID threadId);

    /** Bulk delete used by the document purge; see {@link CommentThreadRepository}. */
    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM Comment c WHERE c.thread.document.id IN :documentIds")
    int deleteByDocumentIds(@Param("documentIds") Collection<UUID> documentIds);
}
