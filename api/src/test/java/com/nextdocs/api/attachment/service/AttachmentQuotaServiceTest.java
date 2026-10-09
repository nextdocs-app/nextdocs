package com.nextdocs.api.attachment.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.nextdocs.api.attachment.config.AttachmentProperties;
import com.nextdocs.api.attachment.entity.AttachmentUsage;
import com.nextdocs.api.attachment.repository.AttachmentRepository;
import com.nextdocs.api.attachment.repository.AttachmentUsageRepository;
import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class AttachmentQuotaServiceTest {

    private static final long GIGABYTE = 1024L * 1024 * 1024;

    @Mock
    private UserRepository userRepository;

    @Mock
    private AttachmentUsageRepository usageRepository;

    @Mock
    private AttachmentRepository attachmentRepository;

    private AttachmentProperties properties;
    private AttachmentQuotaService quotaService;

    private final UUID userId = UUID.randomUUID();
    private User user;

    @BeforeEach
    void setUp() {
        properties = new AttachmentProperties();
        properties.setMaxStoragePerUser("1GB");
        quotaService = new AttachmentQuotaService(userRepository, usageRepository, attachmentRepository, properties);
        user = User.builder().id(userId).build();
    }

    @Test
    void reserve_withinLimit_incrementsTheCounter() {
        stubExistingUsage(100);

        quotaService.reserve(userId, 25);

        assertThat(capturedUsage().getUsedBytes()).isEqualTo(125);
    }

    @Test
    void reserve_exactlyAtLimit_isAllowed() {
        stubExistingUsage(GIGABYTE - 25);

        quotaService.reserve(userId, 25);

        assertThat(capturedUsage().getUsedBytes()).isEqualTo(GIGABYTE);
    }

    @Test
    void reserve_overLimit_throwsPayloadTooLargeAndWritesNothing() {
        stubExistingUsage(GIGABYTE);

        assertApiError(ErrorCode.PAYLOAD_TOO_LARGE, () -> quotaService.reserve(userId, 1));

        verify(usageRepository, never()).saveAndFlush(any());
    }

    @Test
    void reserve_whenQuotaDisabled_acceptsAnyAmount() {
        properties.setMaxStoragePerUser("-1");
        stubExistingUsage(100L * GIGABYTE);

        quotaService.reserve(userId, 25);

        assertThat(capturedUsage().getUsedBytes()).isEqualTo(100L * GIGABYTE + 25);
    }

    @Test
    void reserve_firstUpload_createsTheCounterForThatUser() {
        when(userRepository.findByIdForUpdate(userId)).thenReturn(Optional.of(user));
        when(usageRepository.findForUpdate(userId)).thenReturn(Optional.empty());

        quotaService.reserve(userId, 25);

        // The row is created in the same flush that records the reservation.
        assertThat(capturedUsage().getUserId()).isEqualTo(userId);
        assertThat(capturedUsage().getUsedBytes()).isEqualTo(25);
    }

    @Test
    void reserve_missingUser_throwsNotFound() {
        when(userRepository.findByIdForUpdate(userId)).thenReturn(Optional.empty());

        assertApiError(ErrorCode.NOT_FOUND, () -> quotaService.reserve(userId, 25));

        verify(usageRepository, never()).saveAndFlush(any());
    }

    @Test
    void release_decrementsTheCounterWithOneStatement() {
        quotaService.release(userId, 40);

        verify(usageRepository).decrement(userId, 40);
        // No read-modify-flush cycle: the clamp lives in the UPDATE, not in a loaded entity.
        verify(usageRepository, never()).findForUpdate(any());
        verify(usageRepository, never()).saveAndFlush(any());
    }

    @Test
    void release_withoutCounterRow_isANoOp() {
        when(usageRepository.decrement(userId, 40)).thenReturn(0);

        quotaService.release(userId, 40);

        verify(usageRepository).decrement(userId, 40);
        verify(usageRepository, never()).saveAndFlush(any());
    }

    @Test
    void reserve_nonPositiveBytes_isANoOpWithoutTouchingStores() {
        quotaService.reserve(userId, 0);
        quotaService.reserve(userId, -5);

        // Deleting the guard would lock the user row and flush a counter for nothing.
        verifyNoInteractions(userRepository, usageRepository);
    }

    @Test
    void release_nonPositiveBytes_isANoOpWithoutTouchingStores() {
        quotaService.release(userId, 0);
        quotaService.release(userId, -5);

        // Deleting the guard would issue pointless decrement statements.
        verify(usageRepository, never()).decrement(any(), anyLong());
    }

    @Test
    void releaseForDocuments_decrementsEachUploaderByTheirOwnBytes() {
        UUID otherUserId = UUID.randomUUID();
        when(attachmentRepository.sumSizeBytesByUploader(List.of(userId)))
                .thenReturn(List.of(usageRow(userId, 30L), usageRow(otherUserId, 12L)));

        quotaService.releaseForDocuments(List.of(userId));

        verify(usageRepository).decrement(userId, 30L);
        verify(usageRepository).decrement(otherUserId, 12L);
    }

    @Test
    void releaseForDocuments_overBatchSize_readsTheSumsInBoundedQueries() {
        List<UUID> ids = new ArrayList<>();
        for (int i = 0; i < 501; i++) {
            ids.add(UUID.randomUUID());
        }

        quotaService.releaseForDocuments(ids);

        // 500 + 1: crossing the batch boundary must not build one giant IN clause.
        verify(attachmentRepository).sumSizeBytesByUploader(ids.subList(0, 500));
        verify(attachmentRepository).sumSizeBytesByUploader(ids.subList(500, 501));
    }

    @Test
    void properties_parseQuotaValuesIncludingUnlimited() {
        properties.setMaxStoragePerUser("2GB");
        assertThat(properties.maxStoragePerUserBytes()).isEqualTo(2 * GIGABYTE);

        properties.setMaxStoragePerUser("-1");
        assertThat(properties.maxStoragePerUserBytes()).isEqualTo(-1);

        properties.setMaxStoragePerUser("unlimited");
        assertThat(properties.maxStoragePerUserBytes()).isEqualTo(-1);

        properties.setMaxStoragePerUser("");
        assertThat(properties.maxStoragePerUserBytes()).isEqualTo(-1);
    }

    private void stubExistingUsage(long usedBytes) {
        when(userRepository.findByIdForUpdate(userId)).thenReturn(Optional.of(user));
        when(usageRepository.findForUpdate(userId)).thenReturn(Optional.of(usage(userId, usedBytes)));
    }

    private AttachmentUsage capturedUsage() {
        ArgumentCaptor<AttachmentUsage> captor = ArgumentCaptor.forClass(AttachmentUsage.class);
        verify(usageRepository).saveAndFlush(captor.capture());
        return captor.getValue();
    }

    private static AttachmentUsage usage(UUID ownerId, long usedBytes) {
        return AttachmentUsage.builder().userId(ownerId).usedBytes(usedBytes).build();
    }

    private static AttachmentRepository.UploaderUsage usageRow(UUID uploaderId, long totalBytes) {
        return new TestUploaderUsage(uploaderId, totalBytes);
    }

    private record TestUploaderUsage(UUID uploaderId, Long totalBytes) implements AttachmentRepository.UploaderUsage {
        @Override
        public UUID getUploaderId() {
            return uploaderId;
        }

        @Override
        public Long getTotalBytes() {
            return totalBytes;
        }
    }

    private static void assertApiError(ErrorCode expected, Runnable action) {
        assertThatThrownBy(action::run)
                .isInstanceOf(ApiException.class)
                .extracting(exception -> ((ApiException) exception).getErrorCode())
                .isEqualTo(expected);
    }
}
