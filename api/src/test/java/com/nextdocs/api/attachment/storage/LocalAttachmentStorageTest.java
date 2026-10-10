package com.nextdocs.api.attachment.storage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.nextdocs.api.attachment.config.AttachmentProperties;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class LocalAttachmentStorageTest {

    @TempDir
    Path tempDirectory;

    private LocalAttachmentStorage storage;

    @BeforeEach
    void setUp() {
        AttachmentProperties properties = new AttachmentProperties();
        properties.setStoragePath(tempDirectory.toString());
        storage = new LocalAttachmentStorage(properties);
    }

    private static String storageKey() {
        return UUID.randomUUID() + "/" + UUID.randomUUID();
    }

    @Test
    void putAndOpen_roundTripsContent() throws IOException {
        String key = storageKey();
        byte[] content = "hello attachment".getBytes(StandardCharsets.UTF_8);

        storage.put(key, new ByteArrayInputStream(content));

        StoredAttachment stored = storage.open(key);
        assertThat(stored.sizeBytes()).isEqualTo(content.length);
        assertThat(stored.sizeBytes()).isEqualTo(Files.size(tempDirectory.resolve(key)));
        assertThat(stored.rangesSupported()).isTrue();
        assertThat(stored.resource().exists()).isTrue();
        assertThat(stored.resource().getContentAsByteArray()).isEqualTo(content);
    }

    @Test
    void put_createsStorageDirectoryLazily() {
        Path nested = tempDirectory.resolve("nested/deeper");
        AttachmentProperties properties = new AttachmentProperties();
        properties.setStoragePath(nested.toString());
        LocalAttachmentStorage nestedStorage = new LocalAttachmentStorage(properties);

        assertThat(Files.exists(nested)).isFalse();

        String key = storageKey();
        nestedStorage.put(key, new ByteArrayInputStream("x".getBytes(StandardCharsets.UTF_8)));

        assertThat(Files.exists(nested.resolve(key))).isTrue();
    }

    @Test
    void open_missingFile_throwsNotFound() {
        assertThatThrownBy(() -> storage.open(storageKey()))
                .isInstanceOf(ApiException.class)
                .extracting(exception -> ((ApiException) exception).getErrorCode())
                .isEqualTo(ErrorCode.NOT_FOUND);
    }

    @Test
    void open_invalidStorageKey_throwsNotFound() {
        for (String traversalKey : List.of("not-a-valid-key", "../../etc/passwd", "a/../../b", "/etc/passwd")) {
            assertThatThrownBy(() -> storage.open(traversalKey))
                    .as("open(%s)", traversalKey)
                    .isInstanceOf(ApiException.class)
                    .extracting(exception -> ((ApiException) exception).getErrorCode())
                    .isEqualTo(ErrorCode.NOT_FOUND);
        }
    }

    @Test
    void open_afterDelete_throwsNotFound() {
        String key = storageKey();
        storage.put(key, new ByteArrayInputStream("x".getBytes(StandardCharsets.UTF_8)));
        storage.delete(key);

        assertThatThrownBy(() -> storage.open(key))
                .isInstanceOf(ApiException.class)
                .extracting(exception -> ((ApiException) exception).getErrorCode())
                .isEqualTo(ErrorCode.NOT_FOUND);
    }

    @Test
    void delete_removesFileAndEmptyDocumentDirectory() {
        String key = storageKey();
        storage.put(key, new ByteArrayInputStream("x".getBytes(StandardCharsets.UTF_8)));

        storage.delete(key);

        assertThat(Files.exists(tempDirectory.resolve(key))).isFalse();
        assertThat(Files.exists(tempDirectory.resolve(key.split("/")[0]))).isFalse();
    }

    @Test
    void put_rejectsStorageKeysThatEscapeTheBaseDirectory() {
        assertThatThrownBy(() -> storage.put("../../etc/passwd", new ByteArrayInputStream(new byte[0])))
                .isInstanceOf(ApiException.class)
                .extracting(exception -> ((ApiException) exception).getErrorCode())
                .isEqualTo(ErrorCode.VALIDATION_FAILED);
    }

    @Test
    void delete_ignoresInvalidStorageKeys() throws IOException {
        Path base = tempDirectory.resolve("base");
        AttachmentProperties properties = new AttachmentProperties();
        properties.setStoragePath(base.toString());
        LocalAttachmentStorage scopedStorage = new LocalAttachmentStorage(properties);

        Path outside = tempDirectory.resolve("escape-target.bin");
        Files.writeString(outside, "keep me");

        for (String traversalKey : List.of("not-a-valid-key", "../escape-target.bin", "/etc/passwd")) {
            scopedStorage.delete(traversalKey);
        }

        assertThat(Files.readString(outside)).isEqualTo("keep me");
    }
}
