package com.nextdocs.api.document.entity;

import com.nextdocs.api.auth.entity.User;
import jakarta.persistence.*;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

@Entity
@Table(
        name = "documents",
        indexes = {
            @Index(name = "idx_documents_user_created", columnList = "user_id,created_at"),
            @Index(name = "idx_documents_user_updated", columnList = "user_id,updated_at")
        })
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Document {

    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(nullable = false, length = 255)
    private String title;

    @JdbcTypeCode(SqlTypes.VARBINARY)
    @Column(name = "yjs_state", nullable = false, columnDefinition = "bytea")
    private byte[] yjsState;

    @Column(name = "created_by", length = 255)
    private String createdBy;

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

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
