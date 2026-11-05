package com.nextdocs.api.comment.entity;

import com.nextdocs.api.auth.entity.User;
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
 * One message inside a {@link CommentThread}. The body is a BlockNote comment
 * document (a JSON array of blocks) stored verbatim as text; the service validates
 * the shape and size on write. Authorship is a nullable user FK plus a display-name
 * snapshot, because share-link guests have no account and deleted accounts must
 * keep their comments attributed.
 */
@Entity
@Table(
        name = "comments",
        indexes = {@Index(name = "idx_comments_thread_created", columnList = "thread_id,created_at,id")})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Comment {

    /** Assigned by the service for the same id-preservation reason as the thread. */
    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "thread_id", nullable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private CommentThread thread;

    /** Null for an anonymous share-link commenter or once the account is deleted. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "author_user_id")
    @OnDelete(action = OnDeleteAction.SET_NULL)
    private User author;

    /**
     * Author id copied at write time. Unlike the FK it is not nulled when the
     * account is deleted, so each former member's comments keep a stable identity
     * (the client groups avatars and edit affordances by this id). Null for guests.
     */
    @Column(name = "author_user_key")
    private UUID authorUserKey;

    @Column(name = "author_name", nullable = false, length = 255)
    private String authorName;

    /**
     * BlockNote's comment body. TEXT (not JSONB) because tests build the schema
     * through Hibernate on H2; the API layer owns JSON validation.
     */
    @Column(nullable = false, columnDefinition = "TEXT")
    private String body;

    /** Set by the service so the legacy Yjs import can keep original times. */
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    /** Same H2-schema reason as {@link CommentThread}; the API sets both times. */
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
