package com.nextdocs.api.attachment.config;

import jakarta.annotation.PostConstruct;
import java.time.Duration;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.util.unit.DataSize;

/**
 * Self-hosting configuration for document attachments.
 *
 * <p>Storage is local-disk only for now; the {@code storage-path} directory is the
 * only state outside Postgres, so it must be backed up alongside the database.
 *
 * <p><b>Single-filesystem deployment only.</b> Attachments are written to the node that
 * serves the upload, so every API replica must share the same {@code storage-path}
 * (an NFS/volume mount) or exactly one replica must run. With disjoint local disks a
 * download served by replica B 404s a file uploaded through replica A, and post-commit
 * deletes only reclaim the bytes on the node that handled the delete.
 */
@ConfigurationProperties(prefix = "app.attachments")
@Getter
@Setter
public class AttachmentProperties {

    /** Directory that holds attachment files (created lazily on first upload). */
    private String storagePath = "./data/attachments";

    /** Maximum size of a single uploaded file. */
    private DataSize maxFileSize = DataSize.ofMegabytes(25);

    /**
     * Maximum attachment bytes one user may store across all documents, e.g. {@code 2GB}.
     * {@code -1} or {@code unlimited} disables enforcement while usage is still tracked,
     * so lowering the limit later applies to files that were uploaded before it existed.
     * Any other negative value (e.g. {@code -5MB}) fails startup: it would otherwise
     * read as "no limit" in the reserve check and silently turn quota enforcement off.
     */
    private String maxStoragePerUser = "2GB";

    /** Lifetime of a signed attachment download URL. */
    private Duration urlTtl = Duration.ofMinutes(20);

    /** HMAC key for attachment URL signatures; defaults to the JWT secret. */
    private String signingSecret;

    /** Optional absolute base URL when files are served from another host/CDN. */
    private String publicBaseUrl;

    /** Cached parse of {@link #maxStoragePerUser}, populated during context startup. */
    private Long cachedMaxStoragePerUserBytes;

    /**
     * Parses the quota once at startup so a malformed value fails the boot instead of
     * surfacing as a 500 on the first upload.
     */
    @PostConstruct
    void parseMaxStoragePerUser() {
        cachedMaxStoragePerUserBytes = parseMaxStoragePerUserBytes();
    }

    /**
     * Parsed {@link #maxStoragePerUser}: a positive byte count, or {@code -1} when quota
     * enforcement is disabled. Accepts a Spring {@link DataSize} value (2GB, 512MB) or the
     * literals {@code -1}/{@code unlimited}. Production reads the startup-cached value; the
     * lazy fallback keeps hand-built instances (tests) working without a lifecycle callback.
     */
    public long maxStoragePerUserBytes() {
        Long cached = cachedMaxStoragePerUserBytes;
        return cached != null ? cached : parseMaxStoragePerUserBytes();
    }

    private long parseMaxStoragePerUserBytes() {
        String value = maxStoragePerUser == null ? "" : maxStoragePerUser.strip();
        if (value.isEmpty() || value.equals("-1") || value.equalsIgnoreCase("unlimited")) {
            return -1L;
        }
        long bytes = DataSize.parse(value).toBytes();
        if (bytes < -1L) {
            throw new IllegalArgumentException(
                    "app.attachments.max-storage-per-user must be a non-negative size, -1, or unlimited, got: "
                            + maxStoragePerUser);
        }
        return bytes;
    }
}
