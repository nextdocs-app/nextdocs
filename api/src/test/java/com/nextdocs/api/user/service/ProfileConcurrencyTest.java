package com.nextdocs.api.user.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.nextdocs.api.attachment.storage.AttachmentStorage;
import com.nextdocs.api.attachment.storage.StoredAttachment;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.user.entity.User;
import com.nextdocs.api.user.repository.UserRepository;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest
class ProfileConcurrencyTest {
    private static final byte[] PNG = {(byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a};

    @Autowired
    private ProfileService profiles;

    @Autowired
    private UserRepository users;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @MockitoBean
    private AttachmentStorage storage;

    private UUID userId;

    @BeforeEach
    void setUp() {
        userId = users.saveAndFlush(User.builder()
                        .email(UUID.randomUUID() + "@example.com")
                        .displayName("Original")
                        .passwordHash("hash")
                        .build())
                .getId();
        when(storage.open(any())).thenReturn(new StoredAttachment(new ByteArrayResource(PNG), PNG.length, true));
    }

    @AfterEach
    void cleanUp() {
        users.deleteById(userId);
    }

    @Test
    void uploadUsesFreshStateAfterConcurrentNameUpdateOrRemoval() throws Exception {
        CountDownLatch writing = new CountDownLatch(1);
        CountDownLatch resume = new CountDownLatch(1);
        doAnswer(invocation -> {
                    writing.countDown();
                    if (!resume.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Timed out");
                    return null;
                })
                .when(storage)
                .put(any(), any());
        var executor = Executors.newSingleThreadExecutor();
        try {
            var upload = executor.submit(
                    () -> profiles.replaceAvatar(userId, new MockMultipartFile("file", "a.png", "image/png", PNG)));
            assertThat(writing.await(10, TimeUnit.SECONDS)).isTrue();
            profiles.updateDisplayName(userId, "Updated");
            resume.countDown();
            upload.get(10, TimeUnit.SECONDS);
            User saved = users.findById(userId).orElseThrow();
            assertThat(saved.getDisplayName()).isEqualTo("Updated");
            assertThat(saved.getAvatarId()).isNotNull();
        } finally {
            resume.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void removalDuringUploadCannotReactivateAccount() throws Exception {
        CountDownLatch writing = new CountDownLatch(1);
        CountDownLatch resume = new CountDownLatch(1);
        doAnswer(invocation -> {
                    writing.countDown();
                    if (!resume.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Timed out");
                    return null;
                })
                .when(storage)
                .put(any(), any());
        var executor = Executors.newSingleThreadExecutor();
        try {
            var upload = executor.submit(() -> {
                try {
                    profiles.replaceAvatar(userId, new MockMultipartFile("file", "a.png", "image/png", PNG));
                    return null;
                } catch (ApiException ex) {
                    return ex.getErrorCode();
                }
            });
            assertThat(writing.await(10, TimeUnit.SECONDS)).isTrue();
            new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
                User user = users.findById(userId).orElseThrow();
                user.setActive(false);
            });
            resume.countDown();
            assertThat(upload.get(10, TimeUnit.SECONDS)).isEqualTo(ErrorCode.ACCOUNT_DISABLED);
            User saved = users.findById(userId).orElseThrow();
            assertThat(saved.isActive()).isFalse();
            assertThat(saved.getAvatarId()).isNull();
            verify(storage).delete(any());
        } finally {
            resume.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void staleAccountRemovalDoesNotOverwriteNewProfile() throws Exception {
        CountDownLatch loaded = new CountDownLatch(1);
        CountDownLatch resume = new CountDownLatch(1);
        var executor = Executors.newSingleThreadExecutor();
        try {
            var removal =
                    executor.submit(() -> new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
                        User user = users.findById(userId).orElseThrow();
                        loaded.countDown();
                        try {
                            if (!resume.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Timed out");
                        } catch (InterruptedException ex) {
                            Thread.currentThread().interrupt();
                            throw new IllegalStateException(ex);
                        }
                        user.setActive(false);
                    }));
            assertThat(loaded.await(10, TimeUnit.SECONDS)).isTrue();
            profiles.updateDisplayName(userId, "Updated");
            profiles.replaceAvatar(userId, new MockMultipartFile("file", "a.png", "image/png", PNG));
            resume.countDown();
            removal.get(10, TimeUnit.SECONDS);
            User saved = users.findById(userId).orElseThrow();
            assertThat(saved.isActive()).isFalse();
            assertThat(saved.getDisplayName()).isEqualTo("Updated");
            assertThat(saved.getAvatarId()).isNotNull();
        } finally {
            resume.countDown();
            executor.shutdownNow();
        }
    }
}
