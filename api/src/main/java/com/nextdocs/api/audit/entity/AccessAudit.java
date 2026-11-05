package com.nextdocs.api.audit.entity;

import jakarta.persistence.*;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

/**
 * One append-only access mutation.
 *
 * <p>Principal columns are plain UUIDs rather than associations: the audit row must
 * outlive the user, group, page, or space it names. The workspace association is the
 * tenant boundary and is the only deleting FK.
 */
@Entity
@Table(
        name = "access_audit",
        indexes = {
            @Index(name = "idx_access_audit_document", columnList = "document_id,created_at"),
            @Index(name = "idx_access_audit_space", columnList = "space_id,created_at"),
            @Index(name = "idx_access_audit_workspace", columnList = "workspace_id,created_at")
        })
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AccessAudit {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "workspace_id", nullable = false)
    private UUID workspaceId;

    @Column(name = "document_id")
    private UUID documentId;

    @Column(name = "space_id")
    private UUID spaceId;

    @Column(name = "actor_user_id")
    private UUID actorUserId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 64)
    private AccessAuditAction action;

    @Column(name = "principal_type", length = 32)
    private String principalType;

    @Column(name = "principal_id")
    private UUID principalId;

    /** A short human-readable summary: levels and modes, never content. */
    @Column(length = 1024)
    private String detail;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;
}
