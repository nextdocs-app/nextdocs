package com.nextdocs.api.comment.entity;

import com.nextdocs.api.auth.entity.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
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
 * One person's emoji reaction to one comment. Rows are aggregated by emoji when a
 * thread is serialized, which keeps add/remove a single insert/delete instead of a
 * read-modify-write on a JSON column. Anonymous commenters cannot react: a
 * reaction without a stable identity cannot be removed by the person who added it.
 */
@Entity
@Table(
        name = "comment_reactions",
        uniqueConstraints =
                @UniqueConstraint(
                        name = "uq_comment_reactions_comment_user_emoji",
                        columnNames = {"comment_id", "user_id", "emoji"}))
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CommentReaction {

    /** Assigned by the service; reactions need no externally supplied id. */
    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "comment_id", nullable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private Comment comment;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private User user;

    @Column(nullable = false, length = 64)
    private String emoji;

    /** Set by the service so the legacy Yjs import can keep original times. */
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    /** Same H2-schema reason as {@link CommentThread}; the API sets the time. */
    @PrePersist
    void applyCreatedAt() {
        if (createdAt == null) {
            createdAt = OffsetDateTime.now(ZoneOffset.UTC);
        }
    }
}
