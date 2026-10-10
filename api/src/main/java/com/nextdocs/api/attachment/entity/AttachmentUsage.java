package com.nextdocs.api.attachment.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * Per-user attachment storage counter.
 *
 * <p>One row per user that ever uploaded (or whose uploads were deleted). The key is the
 * user id, so reserving quota can lock the user row and update this counter in one short
 * transaction before any bytes are written.
 */
@Entity
@Table(name = "attachment_usage")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AttachmentUsage {

    @Id
    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "used_bytes", nullable = false)
    private long usedBytes;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
