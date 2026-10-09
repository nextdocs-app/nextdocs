package com.nextdocs.api.attachment.entity;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.document.entity.Document;
import jakarta.persistence.*;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

@Entity
@Table(
        name = "attachments",
        indexes = {@Index(name = "idx_attachments_document_id", columnList = "document_id")})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Attachment {

    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "document_id", nullable = false)
    private Document document;

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

    /** Path of the file inside the storage backend, e.g. {@code <documentId>/<attachmentId>}. */
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
}
