package com.nextdocs.api.comment.entity;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.document.entity.Document;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.OnDelete;
import org.hibernate.annotations.OnDeleteAction;

/**
 * A discussion attached to a document. It carries no document position: BlockNote
 * anchors a thread with a comment mark in the Yjs document body that references
 * {@link #id}, so the position travels with the collaborative document while the
 * discussion lives here.
 *
 * <p>Rows are deleted with their document through the ON DELETE CASCADE declared
 * on the foreign keys (the entity annotations make the H2 test schema match the
 * migration). Resolution records who and when, with the display name snapshotted
 * for deleted accounts and anonymous link commenters.
 */
@Entity
@Table(
        name = "comment_threads",
        indexes = {@Index(name = "idx_comment_threads_document_created", columnList = "document_id,created_at,id")})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CommentThread {

    /**
     * Assigned by the service, not by Hibernate: the legacy importer has to keep the
     * client-supplied thread id so existing BlockNote marks keep resolving, and a
     * generated id makes Hibernate treat that explicit value as a detached entity.
     */
    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "document_id", nullable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private Document document;

    /** Null for an anonymous share-link commenter. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "created_by_user_id")
    @OnDelete(action = OnDeleteAction.SET_NULL)
    private User createdBy;

    @Column(nullable = false)
    @Builder.Default
    private boolean resolved = false;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "resolved_by_user_id")
    @OnDelete(action = OnDeleteAction.SET_NULL)
    private User resolvedBy;

    /** Recorded user id at resolution time, surviving account deletion like comments.author_user_key. */
    @Column(name = "resolved_by_user_key")
    private UUID resolvedByUserKey;

    /** Snapshot for deleted accounts and "Guest"; survives the FK being nulled. */
    @Column(name = "resolved_by_name", length = 255)
    private String resolvedByName;

    @Column(name = "resolved_at")
    private OffsetDateTime resolvedAt;

    /**
     * Set by the service rather than @CreationTimestamp: importing the legacy Yjs
     * threads has to preserve the original discussion time.
     */
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    /**
     * The migration defaults these columns, but Hibernate builds the H2 test schema
     * without those defaults; a repository-level insert must still get both times.
     * The service and the legacy importer set them explicitly and are left alone.
     */
    @PrePersist
    void applyTimestamps() {
        OffsetDateTime timestamp = OffsetDateTime.now(ZoneOffset.UTC);
        if (createdAt == null) {
            createdAt = timestamp;
        }
        if (updatedAt == null) {
            updatedAt = createdAt;
        }
    }
}
