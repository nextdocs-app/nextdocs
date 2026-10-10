package com.nextdocs.api.attachment.service;

import com.nextdocs.api.attachment.entity.Attachment;
import com.nextdocs.api.attachment.repository.AttachmentRepository;
import com.nextdocs.api.attachment.storage.AttachmentStorage;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Persists attachment metadata in its own short transaction.
 *
 * <p>Split out of {@link AttachmentService} because upload is deliberately non-transactional:
 * the disk write can take seconds and must not hold a pooled connection. A separate bean keeps
 * the insert in a real transaction through the Spring proxy, instead of a self-invocation that
 * would silently drop the transactional boundary.
 */
@Service
@RequiredArgsConstructor
public class AttachmentMetadataWriter {

    private final AttachmentRepository attachmentRepository;
    private final AttachmentStorage attachmentStorage;

    /** Inserts the row in a short transaction and arms the rollback hook for the file. */
    @Transactional
    public Attachment insert(Attachment attachment) {
        Attachment saved = attachmentRepository.saveAndFlush(attachment);
        deleteStoredFileOnRollback(saved.getStorageKey());
        return saved;
    }

    /**
     * Deletes the stored bytes if the surrounding transaction rolls back, so a commit failure
     * after the metadata flush cannot leave a file with no database row.
     */
    private void deleteStoredFileOnRollback(String storageKey) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCompletion(int status) {
                if (status != TransactionSynchronization.STATUS_COMMITTED) {
                    attachmentStorage.delete(storageKey);
                }
            }
        });
    }
}
