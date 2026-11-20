package com.nextdocs.api.user.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.nextdocs.api.attachment.AttachmentContentTypes;
import com.nextdocs.api.attachment.storage.AttachmentStorage;
import com.nextdocs.api.attachment.storage.StoredAttachment;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.user.dto.response.UserResponse;
import com.nextdocs.api.user.entity.User;
import com.nextdocs.api.user.repository.UserRepository;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.util.unit.DataSize;
import org.springframework.web.multipart.MultipartFile;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ProfileServiceTest {

    private static final byte[] PNG_BYTES = {
        (byte) 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D
    };

    @Mock
    private UserRepository userRepository;

    @Mock
    private AttachmentStorage attachmentStorage;

    @Mock
    private PlatformTransactionManager transactionManager;

    private ProfileService profileService;
    private UUID userId;
    private User user;

    @BeforeEach
    void setUp() {
        when(transactionManager.getTransaction(any())).thenAnswer(invocation -> new SimpleTransactionStatus());
        profileService =
                new ProfileService(userRepository, attachmentStorage, DataSize.ofMegabytes(2), transactionManager);
        userId = UUID.randomUUID();
        user = User.builder()
                .id(userId)
                .email("ada@example.com")
                .displayName("Ada Lovelace")
                .passwordHash("hash")
                .build();
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(userRepository.findByIdForUpdate(userId)).thenReturn(Optional.of(user));
        when(userRepository.save(any(User.class))).thenAnswer(invocation -> invocation.getArgument(0));
        // A real storage write consumes the stream (and therefore feeds the digest); a
        // no-op mock would hash nothing and hide a broken hashing path.
        doAnswer(invocation -> {
                    invocation.getArgument(1, InputStream.class).readAllBytes();
                    return null;
                })
                .when(attachmentStorage)
                .put(any(), any());
        when(attachmentStorage.open(any())).thenAnswer(invocation -> stored(PNG_BYTES));
    }

    @Test
    void updateDisplayName_normalizesWhitespace() {
        UserResponse response = profileService.updateDisplayName(userId, "  Ada   \n Lovelace ");

        assertThat(response.displayName()).isEqualTo("Ada Lovelace");
        assertThat(user.getDisplayName()).isEqualTo("Ada Lovelace");
    }

    @Test
    void updateDisplayName_rejectsBlankName() {
        assertThatThrownBy(() -> profileService.updateDisplayName(userId, "   "))
                .isInstanceOf(ApiException.class)
                .extracting(ex -> ((ApiException) ex).getErrorCode())
                .isEqualTo(ErrorCode.VALIDATION_FAILED);
    }

    @Test
    void updateDisplayName_rejectsANullName() {
        assertThatThrownBy(() -> profileService.updateDisplayName(userId, null))
                .isInstanceOf(ApiException.class)
                .extracting(ex -> ((ApiException) ex).getErrorCode())
                .isEqualTo(ErrorCode.VALIDATION_FAILED);
    }

    @Test
    void updateDisplayName_rejectsOverlongName() {
        String tooLong = "a".repeat(ProfileService.MAX_DISPLAY_NAME_LENGTH + 1);

        assertThatThrownBy(() -> profileService.updateDisplayName(userId, tooLong))
                .isInstanceOf(ApiException.class)
                .extracting(ex -> ((ApiException) ex).getErrorCode())
                .isEqualTo(ErrorCode.VALIDATION_FAILED);
    }

    @Test
    void updateDisplayName_unknownUser_isNotFound() {
        UUID strangerId = UUID.randomUUID();

        assertThatThrownBy(() -> profileService.updateDisplayName(strangerId, "Ada"))
                .isInstanceOf(ApiException.class)
                .extracting(ex -> ((ApiException) ex).getErrorCode())
                .isEqualTo(ErrorCode.NOT_FOUND);
    }

    @Test
    void replaceAvatar_storesPhotoAndReturnsVersionedUrl() {
        UserResponse response = profileService.replaceAvatar(userId, pngUpload());

        assertThat(user.getAvatarId()).isNotNull();
        assertThat(user.getAvatarContentType()).isEqualTo("image/png");
        // The version in the URL is the id the bytes are stored under: one value, three uses.
        assertThat(response.avatarUrl()).isEqualTo("/api/v1/users/" + userId + "/avatar?v=" + user.getAvatarId());
        verify(attachmentStorage).put(eq(userId + "/" + user.getAvatarId()), any());
    }

    @Test
    void replaceAvatar_deletesTheSupersededFile() {
        UUID previousAvatarId = UUID.randomUUID();
        user.setAvatarId(previousAvatarId);

        profileService.replaceAvatar(userId, pngUpload());

        verify(attachmentStorage).delete(userId + "/" + previousAvatarId);
    }

    @Test
    void replaceAvatar_rejectsAMissingUpload() {
        assertThatThrownBy(() -> profileService.replaceAvatar(userId, null))
                .isInstanceOf(ApiException.class)
                .extracting(ex -> ((ApiException) ex).getErrorCode())
                .isEqualTo(ErrorCode.VALIDATION_FAILED);
        verify(attachmentStorage, never()).put(any(), any());
    }

    @Test
    void replaceAvatar_rejectsEmptyUpload() {
        MockMultipartFile empty = new MockMultipartFile("file", "a.png", "image/png", new byte[0]);

        assertThatThrownBy(() -> profileService.replaceAvatar(userId, empty))
                .isInstanceOf(ApiException.class)
                .extracting(ex -> ((ApiException) ex).getErrorCode())
                .isEqualTo(ErrorCode.VALIDATION_FAILED);
        verify(attachmentStorage, never()).put(any(), any());
    }

    @Test
    void replaceAvatar_rejectsNonRasterBytes() {
        MockMultipartFile svg =
                new MockMultipartFile("file", "a.svg", "image/png", "<svg/>".getBytes(StandardCharsets.UTF_8));

        // The label says PNG; the bytes decide, and they are not a raster image.
        assertThatThrownBy(() -> profileService.replaceAvatar(userId, svg))
                .isInstanceOf(ApiException.class)
                .hasMessage(AttachmentContentTypes.UNSUPPORTED_RASTER_MESSAGE);
        verify(attachmentStorage, never()).put(any(), any());
    }

    @Test
    void replaceAvatar_rejectsADeclaredSizeOverTheLimit() {
        ProfileService oneMegabyte =
                new ProfileService(userRepository, attachmentStorage, DataSize.ofMegabytes(1), transactionManager);
        MockMultipartFile big = new MockMultipartFile("file", "a.png", "image/png", new byte[2 * 1024 * 1024]);

        assertThatThrownBy(() -> oneMegabyte.replaceAvatar(userId, big))
                .isInstanceOf(ApiException.class)
                .hasMessage("Profile photos must be at most 1.0 MB.");
        // Nothing is written, so there is nothing to reclaim either.
        verify(attachmentStorage, never()).put(any(), any());
        assertThat(user.getAvatarId()).isNull();
    }

    @Test
    void replaceAvatar_rejectsStoredBytesOverTheLimit() {
        when(attachmentStorage.open(any())).thenAnswer(invocation -> stored(new byte[3 * 1024 * 1024]));

        assertThatThrownBy(() -> profileService.replaceAvatar(userId, pngUpload()))
                .isInstanceOf(ApiException.class)
                .extracting(ex -> ((ApiException) ex).getErrorCode())
                .isEqualTo(ErrorCode.PAYLOAD_TOO_LARGE);

        // The oversized file is reclaimed and the account keeps its previous photo.
        verify(attachmentStorage).delete(any());
        assertThat(user.getAvatarId()).isNull();
    }

    @Test
    void replaceAvatar_reclaimsTheFileWhenTheRowCannotBeSaved() {
        when(userRepository.save(any(User.class))).thenThrow(new IllegalStateException("boom"));

        assertThatThrownBy(() -> profileService.replaceAvatar(userId, pngUpload()))
                .isInstanceOf(IllegalStateException.class);

        verify(attachmentStorage).delete(any());
    }

    @Test
    void replaceAvatar_reclaimsNewFileWhenCommitFails() {
        UUID previousAvatarId = UUID.randomUUID();
        user.setAvatarId(previousAvatarId);
        doThrow(new IllegalStateException("commit failed"))
                .when(transactionManager)
                .commit(any());

        assertThatThrownBy(() -> profileService.replaceAvatar(userId, pngUpload()))
                .isInstanceOf(IllegalStateException.class);
        verify(attachmentStorage).delete(userId + "/" + user.getAvatarId());
        verify(attachmentStorage, never()).delete(userId + "/" + previousAvatarId);
    }

    @Test
    void replaceAvatar_whenAccountIsRemovedDuringStorage_reclaimsNewFile() {
        doAnswer(invocation -> {
                    user.setActive(false);
                    return null;
                })
                .when(attachmentStorage)
                .put(any(), any());

        assertThatThrownBy(() -> profileService.replaceAvatar(userId, pngUpload()))
                .isInstanceOf(ApiException.class)
                .extracting(ex -> ((ApiException) ex).getErrorCode())
                .isEqualTo(ErrorCode.ACCOUNT_DISABLED);
        assertThat(user.getAvatarId()).isNull();
        verify(attachmentStorage).delete(any());
    }

    @Test
    void replaceAvatar_reportsAnUnreadableUpload() throws Exception {
        // The multipart stream is what can fail once the container hands the part over.
        MultipartFile unreadable = mock(MultipartFile.class);
        when(unreadable.isEmpty()).thenReturn(false);
        when(unreadable.getSize()).thenReturn((long) PNG_BYTES.length);
        when(unreadable.getInputStream()).thenThrow(new IOException("disk"));

        assertThatThrownBy(() -> profileService.replaceAvatar(userId, unreadable))
                .isInstanceOf(ApiException.class)
                .extracting(ex -> ((ApiException) ex).getErrorCode())
                .isEqualTo(ErrorCode.INTERNAL_ERROR);
        assertThat(user.getAvatarId()).isNull();
    }

    @Test
    void replaceAvatar_survivesAFailedSupersededDelete() {
        UUID previousAvatarId = UUID.randomUUID();
        user.setAvatarId(previousAvatarId);
        doThrow(new IllegalStateException("gone")).when(attachmentStorage).delete(any());

        // The new photo is already committed, so a cleanup failure must not fail the request.
        assertThat(profileService.replaceAvatar(userId, pngUpload()).avatarUrl())
                .isNotNull();
        verify(attachmentStorage).delete(userId + "/" + previousAvatarId);
    }

    @Test
    void removeAvatar_clearsThePhotoAndDeletesTheFile() {
        UUID avatarId = UUID.randomUUID();
        user.setAvatarId(avatarId);
        user.setAvatarContentType("image/png");

        UserResponse response = profileService.removeAvatar(userId);

        assertThat(response.avatarUrl()).isNull();
        assertThat(user.getAvatarId()).isNull();
        assertThat(user.getAvatarContentType()).isNull();
        verify(attachmentStorage).delete(userId + "/" + avatarId);
    }

    @Test
    void removeAvatar_withoutAPhoto_isANoOp() {
        UserResponse response = profileService.removeAvatar(userId);

        assertThat(response.avatarUrl()).isNull();
        verify(userRepository, never()).save(any());
        verify(attachmentStorage, never()).delete(any());
    }

    @Test
    void openAvatar_withoutAPhoto_isNotFound() {
        assertThatThrownBy(() -> profileService.openAvatar(userId))
                .isInstanceOf(ApiException.class)
                .extracting(ex -> ((ApiException) ex).getErrorCode())
                .isEqualTo(ErrorCode.NOT_FOUND);
    }

    @Test
    void openAvatar_returnsStoredBytesAndType() {
        UUID avatarId = UUID.randomUUID();
        user.setAvatarId(avatarId);
        user.setAvatarContentType("image/png");

        ProfileService.Avatar avatar = profileService.openAvatar(userId);

        assertThat(avatar.contentType()).isEqualTo("image/png");
        assertThat(avatar.version()).isEqualTo(avatarId.toString());
        assertThat(avatar.stored().sizeBytes()).isEqualTo(PNG_BYTES.length);
    }

    @Test
    void openAvatar_fallsBackToOctetStreamWithoutAStoredType() {
        user.setAvatarId(UUID.randomUUID());

        assertThat(profileService.openAvatar(userId).contentType()).isEqualTo("application/octet-stream");
    }

    @Test
    void getProfile_returnsTheAccount() {
        UserResponse response = profileService.getProfile(userId);

        assertThat(response.id()).isEqualTo(userId);
        assertThat(response.displayName()).isEqualTo("Ada Lovelace");
        assertThat(response.avatarUrl()).isNull();
    }

    @Test
    void getProfile_unknownUser_isNotFound() {
        UUID strangerId = UUID.randomUUID();

        assertThatThrownBy(() -> profileService.getProfile(strangerId))
                .isInstanceOf(ApiException.class)
                .extracting(ex -> ((ApiException) ex).getErrorCode())
                .isEqualTo(ErrorCode.NOT_FOUND);
    }

    @Test
    void getAvatarUrl_isDerivedFromThePhotoVersion() {
        assertThat(user.getAvatarUrl()).isNull();

        UUID avatarId = UUID.randomUUID();
        user.setAvatarId(avatarId);

        assertThat(user.getAvatarUrl()).isEqualTo("/api/v1/users/" + userId + "/avatar?v=" + avatarId);
    }

    private static MockMultipartFile pngUpload() {
        return new MockMultipartFile("file", "a.png", "image/png", PNG_BYTES);
    }

    private static StoredAttachment stored(byte[] bytes) {
        return new StoredAttachment(new ByteArrayResource(bytes), bytes.length, true);
    }
}
