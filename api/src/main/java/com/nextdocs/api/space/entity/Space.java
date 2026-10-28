package com.nextdocs.api.space.entity;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.pageicon.PageIconType;
import com.nextdocs.api.workspace.entity.Workspace;
import jakarta.persistence.*;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * An optional container of root pages with its own access model.
 *
 * <p>{@code icon_*} mirrors the document and workspace columns: NULL means no icon,
 * otherwise one of the {@link PageIconType} sources with its value and an optional
 * builtin-only color key.
 *
 * <p>{@code everyoneAccessLevel} is the grant every workspace member inherits while
 * {@code accessMode} is {@link SpaceAccessMode#PUBLIC}; it is kept across a switch to
 * CUSTOM so the owner's choice survives a round trip. It is never OWNER — only a
 * {@link SpaceMember} row may carry ownership, otherwise every member would be able
 * to administer the space.
 */
@Entity
@Table(name = "spaces", indexes = @Index(name = "idx_spaces_workspace", columnList = "workspace_id,created_at"))
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Space {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "workspace_id", nullable = false)
    private Workspace workspace;

    @Column(nullable = false, length = 255)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(name = "icon_type", length = 16)
    private PageIconType iconType;

    @Column(name = "icon_value", length = 2048)
    private String iconValue;

    @Column(name = "icon_color", length = 32)
    private String iconColor;

    @Enumerated(EnumType.STRING)
    @Column(name = "access_mode", nullable = false, length = 16)
    @Builder.Default
    private SpaceAccessMode accessMode = SpaceAccessMode.CUSTOM;

    @Enumerated(EnumType.STRING)
    @Column(name = "everyone_access_level", nullable = false, length = 16)
    @Builder.Default
    private DocumentAccessLevel everyoneAccessLevel = DocumentAccessLevel.VIEW;

    /**
     * When set, the space is hidden from normal navigation and frozen read-only.
     * Pages, memberships, and attachments stay in place; restoring clears this
     * flag and makes every write path available again.
     */
    @Column(name = "archived_at")
    private OffsetDateTime archivedAt;

    /** Who archived the space, for audit. Null when the space is active. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "archived_by_user_id")
    private User archivedBy;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
