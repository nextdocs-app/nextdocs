package com.nextdocs.api.mention.entity;

import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.user.entity.User;
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
 * The current set of people mentioned in a document body.
 *
 * <p>Realtime extracts this set from the Y.Doc on every compaction; the API never
 * parses Yjs. Reconciling by {@code (document_id, mentioned_user_id)} means the table
 * always reflects the live body, and a mention removed before delivery is not
 * notified. Two cases insert with {@code notifiedAt} already set because there is no
 * edit to notify about: a search reindex repairs an index rather than an edit, and a
 * document whose share link allows EDIT is anonymously writable, so its body has no
 * author to attribute (see {@code MentionService.reconcileDocumentMentions}).
 */
@Entity
@Table(
        name = "document_mentions",
        uniqueConstraints =
                @UniqueConstraint(
                        name = "uq_document_mentions_document_user",
                        columnNames = {"document_id", "mentioned_user_id"}))
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DocumentMention {

    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "document_id", nullable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private Document document;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "mentioned_user_id", nullable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private User mentionedUser;

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
