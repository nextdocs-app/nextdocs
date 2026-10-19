package com.nextdocs.api.attachment.entity;

import com.nextdocs.api.attachment.AttachmentScope;
import com.nextdocs.api.attachment.AttachmentVisibility;
import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.workspace.entity.Workspace;
import jakarta.persistence.*;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

@Entity
@Table(
        name = "attachments",
        indexes = {
            @Index(name = "idx_attachments_document_id", columnList = "document_id"),
            @Index(name = "idx_attachments_workspace_id", columnList = "workspace_id")
        })
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Attachment {

    @Id
    private UUID id;

    /** Document scope; null when the attachment is workspace-scoped. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "document_id")
    private Document document;

    /** Workspace scope; null when the attachment is document-scoped. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "workspace_id")
    private Workspace workspace;

    /**
     * Anonymous-read flag, separate from ownership. Document attachments always stay
     * private because their audience is the document. Only workspace branding assets
     * are public.
     */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    @Builder.Default
    private AttachmentVisibility visibility = AttachmentVisibility.PRIVATE;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "uploaded_by", nullable = false)
    private User uploadedBy;

    /** Original file name, sanitized for use in Content-Disposition. */
    @Column(name = "file_name", nullable = false, length = 255)
    private String fileName;

    @Column(name = "content_type", nullable = false, length = 255)
    private String contentType;

    @Column(name = "size_bytes", nullable = false)
    private long sizeBytes;

    /** Path of the file inside the storage backend, e.g. {@code <scopeId>/<attachmentId>}. */
    @Column(name = "storage_key", nullable = false, length = 512, unique = true)
    private String storageKey;

    /**
     * Hex-encoded SHA-256 of the stored bytes. Write-only audit metadata for now: no
     * reader verifies or dedupes against it yet, but it is cheap to capture at upload
     * and impossible to backfill accurately afterwards.
     */
    @Column(nullable = false, length = 64)
    private String sha256;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    /**
     * The single scope this row is bound to. Every call site that needs to know
     * what an attachment belongs to reads this instead of the FKs, so the
     * document/workspace split stays inside this class.
     */
    public AttachmentScope scope() {
        return document != null
                ? AttachmentScope.document(document.getId())
                : AttachmentScope.workspace(workspace.getId());
    }

    /** True only for workspace branding assets that public share pages may read. */
    public boolean isPublic() {
        return visibility == AttachmentVisibility.PUBLIC;
    }
}
