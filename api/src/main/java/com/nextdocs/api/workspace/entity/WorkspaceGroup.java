package com.nextdocs.api.workspace.entity;

import jakarta.persistence.*;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * A flat workspace group used as a page-grant principal.
 *
 * <p>Groups belong to exactly one workspace. Membership is a join table rather than a
 * role on the user because a user can belong to many groups and a group has no
 * administrative privileges of its own.
 */
@Entity
@Table(
        name = "workspace_groups",
        uniqueConstraints = {
            @UniqueConstraint(
                    name = "uq_workspace_group_external",
                    columnNames = {"workspace_id", "external_id"})
        },
        indexes = @Index(name = "idx_workspace_groups_workspace", columnList = "workspace_id"))
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class WorkspaceGroup {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "workspace_id", nullable = false)
    private Workspace workspace;

    @Column(nullable = false, length = 255)
    private String name;

    @Column(name = "external_id", length = 255)
    private String externalId;

    @Column(nullable = false, length = 32)
    @Builder.Default
    private String source = "MANUAL";

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
