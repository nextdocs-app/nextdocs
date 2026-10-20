package com.nextdocs.api.workspace.entity;

import com.nextdocs.api.auth.entity.User;
import jakarta.persistence.*;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

/**
 * Membership of a user in the workspace, carrying the administrative role.
 *
 * <p>One row per user (the single workspace of the instance): the unique constraint
 * on {@code (workspace_id, user_id)} is what makes a double invite unable to create
 * two memberships.
 */
@Entity
@Table(
        name = "workspace_members",
        uniqueConstraints =
                @UniqueConstraint(
                        name = "uq_workspace_member",
                        columnNames = {"workspace_id", "user_id"}),
        indexes = @Index(name = "idx_workspace_members_user", columnList = "user_id"))
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class WorkspaceMember {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "workspace_id", nullable = false)
    private Workspace workspace;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private WorkspaceRole role;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;
}
