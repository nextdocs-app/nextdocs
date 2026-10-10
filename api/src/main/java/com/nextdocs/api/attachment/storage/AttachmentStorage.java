package com.nextdocs.api.attachment.storage;

import java.io.InputStream;

/**
 * Backend-agnostic attachment storage.
 *
 * <p>The only implementation today is {@link LocalAttachmentStorage} (self-hosted
 * filesystem, no external dependencies). An S3-compatible implementation can be added
 * later without touching callers.
 */
public interface AttachmentStorage {

    /** Stores the stream at {@code storageKey}, replacing any previous content. */
    void put(String storageKey, InputStream data);

    /** Opens a stored file; implementations fail with a 404-style error when absent. */
    StoredAttachment open(String storageKey);

    /** Removes a stored file; missing files are ignored. */
    void delete(String storageKey);
}
