package com.nextdocs.api.workspace.entity;

import com.nextdocs.api.pageicon.PageIconType;
import jakarta.persistence.*;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * The single workspace of a self-hosted instance.
 *
 * <p>{@code icon_*} mirrors the document columns: NULL means no icon, otherwise one
 * of the {@link PageIconType} sources with its value (emoji grapheme, builtin slug,
 * attachment id, or URL) and an optional builtin-only color key.
 */
@Entity
@Table(name = "workspaces")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Workspace {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, length = 255)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(name = "icon_type", length = 16)
    private PageIconType iconType;

    @Column(name = "icon_value", length = 2048)
    private String iconValue;

    @Column(name = "icon_color", length = 32)
    private String iconColor;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
