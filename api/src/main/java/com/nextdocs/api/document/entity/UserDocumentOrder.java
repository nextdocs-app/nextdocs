package com.nextdocs.api.document.entity;

import com.nextdocs.api.auth.entity.User;
import jakarta.persistence.*;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

@Entity
@Table(
        name = "user_document_orders",
        uniqueConstraints = {
            @UniqueConstraint(
                    name = "uq_user_document_orders_user_doc",
                    columnNames = {"user_id", "document_id"}),
            @UniqueConstraint(
                    name = "idx_user_document_orders_user_order_key",
                    columnNames = {"user_id", "order_key"})
        },
        indexes = {
            @Index(name = "idx_user_document_orders_user_order", columnList = "user_id,order_key"),
            @Index(name = "idx_user_document_orders_doc", columnList = "document_id")
        })
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class UserDocumentOrder {

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
