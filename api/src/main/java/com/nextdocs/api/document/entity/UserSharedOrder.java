package com.nextdocs.api.document.entity;

import com.nextdocs.api.user.entity.User;
import jakarta.persistence.*;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * The caller's position in their own Shared section.
 *
 * <p>Separate from {@link UserDocumentOrder} on purpose: Shared order is a view
 * order, while a space page's own position is shared content. Keeping the two in
 * one key space made a personal drag able to collide with, or reindex, a document
 * the caller never moved.
 *
 * <p>A document can have a row here and a Private row at the same time. Sharing a
 * root does not destroy its Private position, so unsharing returns it to where it
 * was; leaving a space reuses the Shared position it had before. The row itself is
 * also kept when a page leaves the section (the owner keeps a position across an
 * unshare), so this table is not a membership set: only the listing query decides
 * whether an entry is visible today.
 */
@Entity
@Table(
        name = "user_shared_document_orders",
        uniqueConstraints = {
            @UniqueConstraint(
                    name = "uq_user_shared_orders_user_doc",
                    columnNames = {"user_id", "document_id"}),
            @UniqueConstraint(
                    name = "uq_user_shared_orders_user_order_key",
                    columnNames = {"user_id", "order_key"})
        },
        indexes = {@Index(name = "idx_user_shared_orders_doc", columnList = "document_id")})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class UserSharedOrder {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "document_id", nullable = false)
    private Document document;

    @Column(name = "order_key", nullable = false)
    private String orderKey;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
