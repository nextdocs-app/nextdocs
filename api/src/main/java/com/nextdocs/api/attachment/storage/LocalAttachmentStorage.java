package com.nextdocs.api.attachment.storage;

import com.nextdocs.api.attachment.config.AttachmentProperties;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.FileSystemResource;
import org.springframework.stereotype.Component;

/**
 * Self-hosted filesystem storage: {@code <storagePath>/<documentId>/<attachmentId>}.
 *
 * <p>Keys are never derived from user input — they are two server-generated UUIDs — and
 * every key is re-validated before touching the filesystem, so a compromised or corrupted
 * database row cannot escape the configured directory.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class LocalAttachmentStorage implements AttachmentStorage {

    private static final Pattern STORAGE_KEY =
            Pattern.compile("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
                    + "/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");

    private final AttachmentProperties attachmentProperties;

    @Override
    public void put(String storageKey, InputStream data) {
        Path target = resolve(storageKey);
        try {
            Files.createDirectories(target.getParent());
            // Write to a sibling temp file first so a failed upload never leaves a
            // partially written file at the real path.
            Path tempFile = Files.createTempFile(
                    target.getParent(), target.getFileName().toString(), ".part");
            try {
                Files.copy(data, tempFile, StandardCopyOption.REPLACE_EXISTING);
                try {
                    Files.move(tempFile, target, StandardCopyOption.ATOMIC_MOVE);
                } catch (AtomicMoveNotSupportedException ex) {
                    Files.move(tempFile, target, StandardCopyOption.REPLACE_EXISTING);
                }
            } finally {
                Files.deleteIfExists(tempFile);
            }
        } catch (IOException ex) {
            log.error("Failed to store attachment {}: {}", storageKey, ex.getMessage());
            throw new ApiException(ErrorCode.INTERNAL_ERROR, "Failed to store the uploaded file.");
        }
    }

    @Override
    public StoredAttachment open(String storageKey) {
        Path target;
        try {
            target = resolve(storageKey);
        } catch (ApiException ex) {
            // A corrupted database key means the file is unavailable, which is a 404 to a
            // downloader; VALIDATION_FAILED would wrongly blame the request for a server bug.
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
        if (!Files.isReadable(target)) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
        try {
            return new StoredAttachment(new FileSystemResource(target), Files.size(target), true);
        } catch (IOException ex) {
            log.warn("Failed to read attachment {}: {}", storageKey, ex.getMessage());
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
    }

    @Override
    public void delete(String storageKey) {
        Path target;
        try {
            target = resolve(storageKey);
        } catch (ApiException ex) {
            log.warn("Refusing to delete attachment with invalid storage key: {}", storageKey);
            return;
        }
        try {
            Files.deleteIfExists(target);
            removeEmptyParentDirectory(target.getParent());
        } catch (IOException ex) {
            log.warn("Failed to delete attachment file {}: {}", storageKey, ex.getMessage());
        }
    }

    private void removeEmptyParentDirectory(Path parent) throws IOException {
        if (parent == null || !Files.isDirectory(parent)) {
            return;
        }
        try (Stream<Path> entries = Files.list(parent)) {
            if (entries.findAny().isEmpty()) {
                Files.deleteIfExists(parent);
            }
        }
    }

    private Path resolve(String storageKey) {
        if (storageKey == null || !STORAGE_KEY.matcher(storageKey).matches()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Invalid attachment storage key.");
        }
        Path baseDirectory = Paths.get(attachmentProperties.getStoragePath())
                .toAbsolutePath()
                .normalize();
        Path resolved = baseDirectory.resolve(storageKey).normalize();
        if (!resolved.startsWith(baseDirectory)) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Invalid attachment storage key.");
        }
        return resolved;
    }
}
