package com.nextdocs.api.comment.service;

import com.nextdocs.api.comment.repository.CommentReactionRepository;
import com.nextdocs.api.comment.repository.CommentRepository;
import com.nextdocs.api.comment.repository.CommentThreadRepository;
import java.util.Collection;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * Removes comment rows when a document subtree is permanently purged. The foreign
 * keys cascade in both the migration and the H2 schema (the entities declare
 * ON DELETE CASCADE), but the purge already walks documents by id with bulk
 * deletes; going children-first keeps it independent of database cascade settings
 * and avoids a surprise if a future migration drops one.
 */
@Component
@RequiredArgsConstructor
public class CommentCleanup {

    private final CommentReactionRepository reactionRepository;
    private final CommentRepository commentRepository;
    private final CommentThreadRepository threadRepository;

    public void deleteForDocuments(Collection<UUID> documentIds) {
        if (documentIds == null || documentIds.isEmpty()) {
            return;
        }
        // Reactions reference comments, comments reference threads, threads reference
        // documents: each delete has to run before its parent level.
        reactionRepository.deleteByDocumentIds(documentIds);
        commentRepository.deleteByDocumentIds(documentIds);
        threadRepository.deleteByDocumentIds(documentIds);
    }
}
