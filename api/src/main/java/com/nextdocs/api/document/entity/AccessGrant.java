package com.nextdocs.api.document.entity;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.workspace.entity.Workspace;
import jakarta.persistence.*;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * One page-level grant or No access barrier.
 *
 * <p>The schema keeps users, groups, and audiences in one table because they are
 * different principals of the same permission decision. Membership and public-link
 * settings stay in their own stores; they are baselines/channels, not page grants.
 *
 * <p>Every persisted grant belongs to a workspace, matching the V31 database constraint.
 */
@Entity
@Table(
        name = "access_grants",
        indexes = {
            @Index(name = "idx_access_grants_document", columnList = "document_id"),
            @Index(name = "idx_access_grants_workspace_document", columnList = "workspace_id,document_id")
        })
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AccessGrant {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "workspace_id", nullable = false)
    private Workspace workspace;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "document_id", nullable = false)
    private Document document;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id")
    private User user;

    @Column(name = "group_id")
    private UUID groupId;

    @Column(length = 32)
    private String audience;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 8)
    private AccessGrantEffect effect;

    @Enumerated(EnumType.STRING)
    @Column(name = "access_level", length = 16)
    private DocumentAccessLevel accessLevel;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "created_by_user_id")
    private User createdBy;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
