package com.nextdocs.api.mention.repository;

import com.nextdocs.api.mention.entity.CommentMention;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface CommentMentionRepository extends JpaRepository<CommentMention, UUID> {

    /** The current index rows for one comment, with the mentioned person loaded. */
    @EntityGraph(attributePaths = "mentionedUser")
    List<CommentMention> findAllByComment_Id(UUID commentId);
}
