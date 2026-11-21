package com.nextdocs.api.mention.repository;

import com.nextdocs.api.mention.entity.DocumentMention;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface DocumentMentionRepository extends JpaRepository<DocumentMention, UUID> {

    /** The current mention set for one document, with each person loaded. */
    @EntityGraph(attributePaths = "mentionedUser")
    List<DocumentMention> findAllByDocument_Id(UUID documentId);
}
