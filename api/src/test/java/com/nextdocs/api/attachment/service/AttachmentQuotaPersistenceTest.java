package com.nextdocs.api.attachment.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.nextdocs.api.attachment.entity.Attachment;
import com.nextdocs.api.attachment.repository.AttachmentRepository;
import com.nextdocs.api.attachment.repository.AttachmentUsageRepository;
import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.repository.DocumentRepository;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * Round-trips the quota counter through a real database (H2 here, Postgres in CI): the
 * entity mapping, the pessimistic locks that make the reservation atomic, and the
 * per-uploader release all have to work against actual SQL, not mocks.
 */
@SpringBootTest
class AttachmentQuotaPersistenceTest {

    /** Matches the default app.attachments.max-storage-per-user used by the test properties. */
    private static final long DEFAULT_QUOTA_BYTES = 2L * 1024 * 1024 * 1024;

    @Autowired
    private AttachmentQuotaService quotaService;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private DocumentRepository documentRepository;

    @Autowired
    private AttachmentRepository attachmentRepository;

    @Autowired
    private AttachmentUsageRepository usageRepository;

    private User user;
    private Document document;

    @BeforeEach
    void setUp() {
        user = userRepository.saveAndFlush(User.builder()
                .email("quota-" + UUID.randomUUID() + "@example.com")
                .displayName("Quota User")
                .build());
        document = documentRepository.saveAndFlush(Document.builder()
                .id(UUID.randomUUID())
                .user(user)
                .title("Quota doc")
                .yjsState("seed".getBytes(StandardCharsets.UTF_8))
                .build());
    }

    @Test
    void reserveThenRelease_roundTripsThroughTheDatabase() {
        quotaService.reserve(user.getId(), 100);

        assertThat(usageRepository.findById(user.getId()).orElseThrow().getUsedBytes())
                .isEqualTo(100);

        quotaService.release(user.getId(), 40);

        assertThat(usageRepository.findById(user.getId()).orElseThrow().getUsedBytes())
                .isEqualTo(60);
    }

    @Test
    void reserve_overTheConfiguredLimit_isRejectedAndKeepsTheCounter() {
        quotaService.reserve(user.getId(), DEFAULT_QUOTA_BYTES);

        assertThatThrownBy(() -> quotaService.reserve(user.getId(), 1))
                .isInstanceOf(ApiException.class)
                .extracting(ex -> ((ApiException) ex).getErrorCode())
                .isEqualTo(ErrorCode.PAYLOAD_TOO_LARGE);

        // A rejected reservation must not move the counter.
        assertThat(usageRepository.findById(user.getId()).orElseThrow().getUsedBytes())
                .isEqualTo(DEFAULT_QUOTA_BYTES);
    }

    @Test
    void release_belowZero_floorsAtZeroAgainstTheDatabase() {
        quotaService.reserve(user.getId(), 10);

        quotaService.release(user.getId(), 40);

        // The clamp is applied by the UPDATE itself, so the counter can never go negative
        // even when a deletion over-reports what was actually reserved.
        assertThat(usageRepository.findById(user.getId()).orElseThrow().getUsedBytes())
                .isZero();
    }

    @Test
    void reserve_concurrentAtTheLimit_letsExactlyOneUploadThrough() throws Exception {
        // The pessimistic lock is the whole justification for the quota: without it both
        // threads would read the same headroom and both write. Hold the limit two bytes
        // short, then race two reservations that each fit alone but not together.
        quotaService.reserve(user.getId(), DEFAULT_QUOTA_BYTES - 2);

        int attempts = 2;
        CountDownLatch ready = new CountDownLatch(attempts);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(attempts);
        try {
            List<Future<Boolean>> results = new ArrayList<>();
            for (int i = 0; i < attempts; i++) {
                results.add(pool.submit(() -> {
                    ready.countDown();
                    start.await();
                    try {
                        quotaService.reserve(user.getId(), 2);
                        return true;
                    } catch (ApiException ex) {
                        return false;
                    }
                }));
            }
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();

            long winners = 0;
            for (Future<Boolean> result : results) {
                if (result.get(30, TimeUnit.SECONDS)) {
                    winners++;
                }
            }
            assertThat(winners).isEqualTo(1);
        } finally {
            pool.shutdownNow();
        }

        assertThat(usageRepository.findById(user.getId()).orElseThrow().getUsedBytes())
                .isEqualTo(DEFAULT_QUOTA_BYTES);
    }

    @Test
    void releaseForDocuments_returnsEachUploadersBytesBeforeTheRowsAreDeleted() {
        attachmentRepository.saveAndFlush(Attachment.builder()
                .id(UUID.randomUUID())
                .document(document)
                .uploadedBy(user)
                .fileName("clip.mp4")
                .contentType("video/mp4")
                .sizeBytes(300)
                .storageKey(document.getId() + "/" + UUID.randomUUID())
                .sha256("0".repeat(64))
                .build());
        quotaService.reserve(user.getId(), 300);

        quotaService.releaseForDocuments(List.of(document.getId()));

        assertThat(usageRepository.findById(user.getId()).orElseThrow().getUsedBytes())
                .isZero();
    }
}
