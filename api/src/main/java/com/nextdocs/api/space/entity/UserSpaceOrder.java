package com.nextdocs.api.space.entity;

import com.nextdocs.api.auth.entity.User;
import jakarta.persistence.*;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * One user's position for a space in their sidebar.
 *
 * <p>Spaces are personal navigation entries, not shared content containers, so a
 * move changes only this row. The order key shares a fractional-index space with
 * the user's other spaces, mirroring {@code UserDocumentOrder} for root pages.
 */
@Entity
@Table(
        name = "user_space_orders",
        uniqueConstraints = {
            @UniqueConstraint(
                    name = "uq_user_space_orders_user_space",
                    columnNames = {"user_id", "space_id"}),
            @UniqueConstraint(
                    name = "uq_user_space_orders_user_order_key",
                    columnNames = {"user_id", "order_key"})
        },
        indexes = {
            @Index(name = "idx_user_space_orders_user_order", columnList = "user_id,order_key"),
            @Index(name = "idx_user_space_orders_space", columnList = "space_id")
        })
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class UserSpaceOrder {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "space_id", nullable = false)
    private Space space;

    @Column(name = "order_key", nullable = false)
    private String orderKey;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
