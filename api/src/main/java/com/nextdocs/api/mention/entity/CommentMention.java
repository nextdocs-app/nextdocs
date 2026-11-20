package com.nextdocs.api.mention.entity;

import com.nextdocs.api.comment.entity.Comment;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.user.entity.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
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
 * One person mentioned in one comment. The comment body remains the content; this row
 * is the derived index a future notification worker scans.
 *
 * <p>Only authenticated comment authors produce rows: an anonymous share-link comment
 * has no actor to attribute and must not be able to notify workspace members.
 * {@code notifiedAt} stays null until delivery, so editing a comment that keeps the
 * same mention does not enqueue it twice.
 */
@Entity
@Table(
        name = "comment_mentions",
        uniqueConstraints =
                @UniqueConstraint(
                        name = "uq_comment_mentions_comment_user",
                        columnNames = {"comment_id", "mentioned_user_id"}),
        indexes = {@Index(name = "idx_comment_mentions_document", columnList = "document_id")})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CommentMention {

    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "comment_id", nullable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private Comment comment;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "document_id", nullable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private Document document;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "mentioned_user_id", nullable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private User mentionedUser;

    /** The comment author, or null for a guest comment (which never creates a row). */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "mentioned_by_user_id")
    @OnDelete(action = OnDeleteAction.SET_NULL)
    private User mentionedByUser;

    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    /** Null until the future notification worker has handled this row. */
    @Column(name = "notified_at")
    private OffsetDateTime notifiedAt;

    /** The H2 test schema is built by Hibernate, so the service supplies the time. */
    @PrePersist
    void applyCreatedAt() {
        if (createdAt == null) {
            createdAt = OffsetDateTime.now(ZoneOffset.UTC);
        }
    }
}
