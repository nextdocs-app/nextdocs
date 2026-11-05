package com.nextdocs.api.comment.repository;

import com.nextdocs.api.comment.entity.CommentThread;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CommentThreadRepository extends JpaRepository<CommentThread, UUID> {

    /**
     * Every thread of a document in creation order. `resolvedBy` is the one relation
     * the response renders, so it is fetched with the thread instead of once per row.
     */
    @EntityGraph(attributePaths = {"resolvedBy"})
    List<CommentThread> findAllByDocument_IdOrderByCreatedAtAscIdAsc(UUID documentId);

    @EntityGraph(attributePaths = {"resolvedBy"})
    Optional<CommentThread> findByIdAndDocument_Id(UUID id, UUID documentId);

    /** Bulk delete used by the document purge after reactions and comments. */
    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM CommentThread t WHERE t.document.id IN :documentIds")
    int deleteByDocumentIds(@Param("documentIds") Collection<UUID> documentIds);
}
