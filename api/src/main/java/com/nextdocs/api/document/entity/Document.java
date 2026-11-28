package com.nextdocs.api.document.entity;

import com.nextdocs.api.pageicon.PageIconType;
import com.nextdocs.api.space.entity.Space;
import com.nextdocs.api.user.entity.User;
import com.nextdocs.api.workspace.entity.Workspace;
import jakarta.persistence.*;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * Document metadata, access, and tree position.
 *
 * <p>Content is deliberately absent: Yhub owns the document body. The API reads it
 * on demand for first paint and never stores a copy, so there is exactly one writer
 * and one source of truth.
 */
@Entity
@Table(
        name = "documents",
        indexes = {@Index(name = "idx_documents_parent_sibling_order", columnList = "parent_id,sibling_order_key")})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Document {

    @Id
    private UUID id;

    /**
     * Creator attribution only: set by the server from the authenticated caller, never
     * used to resolve access. Nullable so an anonymous create has no attribution.
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "created_by")
    private User creator;

    @Column(nullable = false, length = 255)
    private String title;

    @Enumerated(EnumType.STRING)
    @Column(name = "icon_type", length = 16)
    private PageIconType iconType;

    @Column(name = "icon_value", length = 2048)
    private String iconValue;

    @Column(name = "icon_color", length = 32)
    private String iconColor;

    @Enumerated(EnumType.STRING)
    @Column(name = "cover_type", length = 16)
    private DocumentCoverType coverType;

    @Column(name = "cover_value", length = 2048)
    private String coverValue;

    /** Vertical focal offset in [0, 1]; only meaningful while a cover is set. */
    @Column(name = "cover_position")
    private Double coverPosition;

    @Column(name = "deleted_at")
    private OffsetDateTime deletedAt;

    @Enumerated(EnumType.STRING)
    @Column(name = "general_access_mode", nullable = false, length = 32)
    @Builder.Default
    private DocumentGeneralAccessMode generalAccessMode = DocumentGeneralAccessMode.RESTRICTED;

    @Enumerated(EnumType.STRING)
    @Column(name = "link_access_level", nullable = false, length = 16)
    @Builder.Default
    private DocumentAccessLevel linkAccessLevel = DocumentAccessLevel.VIEW;

    /**
     * Blocks share-link inheritance for this document and its descendants.
     * The general-access analogue of a NO_ACCESS collaborator breakpoint,
     * scoped to the anonymous link channel only: owner and collaborator grants
     * keep resolving while public (guest) access reports private, until a
     * descendant sets its own ANYONE_WITH_LINK override.
     */
    @Column(name = "link_inherit_blocked", nullable = false)
    @Builder.Default
    private boolean linkInheritBlocked = false;

    /** When the own share link stops being a grant; null means no expiry. */
    @Column(name = "link_expires_at")
    private OffsetDateTime linkExpiresAt;

    /**
     * General access for signed-in workspace members. This is deliberately a separate
     * channel from the anonymous link: workspace membership must not be inferred from a
     * link grant, and a link block must not silently change signed-in access.
     *
     * <p>It is one channel with one rule, nearest first: this page's own setting, then an
     * ancestor page's, then the everyone level of a PUBLIC space anchoring the tree. A
     * space is a permission container, so a page inside it overrides or blocks the space
     * audience exactly like an ancestor page's. A space membership is a separate per-person
     * grant and is never demoted by a page audience setting.
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "workspace_access_mode", nullable = false, length = 32)
    @Builder.Default
    private DocumentWorkspaceAccessMode workspaceAccessMode = DocumentWorkspaceAccessMode.RESTRICTED;

    @Enumerated(EnumType.STRING)
    @Column(name = "workspace_access_level", nullable = false, length = 16)
    @Builder.Default
    private DocumentAccessLevel workspaceAccessLevel = DocumentAccessLevel.VIEW;

    @Column(name = "workspace_inherit_blocked", nullable = false)
    @Builder.Default
    private boolean workspaceInheritBlocked = false;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "parent_id")
    private Document parent;

    /**
     * The space this page is filed into, or null for the caller's Private and Shared
     * sections. A space anchors at a root page (V24's chk_documents_space_root); its
     * descendants inherit the space grant through the parent chain.
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "space_id")
    private Space space;

    /**
     * The workspace that owns this document. Nullable in H2 fixtures that predate
     * V31; production V31 backfills it and makes the column non-null.
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "workspace_id")
    private Workspace workspace;

    @Column(name = "sibling_order_key")
    private String siblingOrderKey;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
