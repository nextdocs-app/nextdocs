package com.nextdocs.api.realtime.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * The single projection cursor row plus its writer lease.
 *
 * <p>Every API instance schedules the projection job, but only one may advance the
 * cursor at a time: two writers applying the same page would both write {@code yjsState}
 * and the later one could store an older snapshot with a newer clock. The lease makes a
 * crashed instance recoverable without operator action.
 */
@Entity
@Table(name = "yhub_projection_state")
@Getter
@Setter
@NoArgsConstructor
public class YhubProjectionState {

    public static final short SINGLETON_ID = 1;

    @Id
    private Short id;

    /** Yhub's {@code updated} cursor: the last sequence number fully projected. */
    @Column(nullable = false)
    private long cursor;

    @Column(name = "lease_owner")
    private UUID leaseOwner;

    @Column(name = "lease_expires_at")
    private OffsetDateTime leaseExpiresAt;

    @Column(name = "last_success_at")
    private OffsetDateTime lastSuccessAt;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
