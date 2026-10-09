package com.nextdocs.api.attachment.repository;

import com.nextdocs.api.attachment.entity.Attachment;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AttachmentRepository extends JpaRepository<Attachment, UUID> {

    @Query("SELECT a.storageKey FROM Attachment a WHERE a.document.id IN :documentIds")
    List<String> findStorageKeysByDocumentIds(@Param("documentIds") Collection<UUID> documentIds);

    /**
     * Bytes per uploader for the given documents. Read before the rows are deleted so the
     * per-user usage counter can be decremented by exactly what leaves the disk.
     */
    @Query("SELECT a.uploadedBy.id AS uploaderId, SUM(a.sizeBytes) AS totalBytes FROM Attachment a "
            + "WHERE a.document.id IN :documentIds GROUP BY a.uploadedBy.id")
    List<UploaderUsage> sumSizeBytesByUploader(@Param("documentIds") Collection<UUID> documentIds);

    /** Typed row for {@link #sumSizeBytesByUploader}: no Object[] casts at the call site. */
    interface UploaderUsage {
        UUID getUploaderId();

        Long getTotalBytes();
    }

    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM Attachment a WHERE a.document.id IN :documentIds")
    int deleteByDocumentIds(@Param("documentIds") Collection<UUID> documentIds);
}
