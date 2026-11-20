package com.nextdocs.api.user.service;

import com.nextdocs.api.attachment.AttachmentContentTypes;
import com.nextdocs.api.attachment.storage.AttachmentStorage;
import com.nextdocs.api.attachment.storage.StoredAttachment;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.user.dto.response.UserResponse;
import com.nextdocs.api.user.entity.User;
import com.nextdocs.api.user.repository.UserRepository;
import java.io.IOException;
import java.io.PushbackInputStream;
import java.util.Locale;
import java.util.UUID;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.unit.DataSize;
import org.springframework.web.multipart.MultipartFile;

/**
 * The signed-in account's own profile: its display name and its photo.
 *
 * <p>Only these two are editable. Changing an email address needs a verification
 * round-trip to the new mailbox and changing a password needs the current one plus
 * revocation of the other sessions; both are separate features, not fields on this form.
 *
 * <p>The photo is stored through {@link AttachmentStorage} under {@code <userId>/<version>}
 * — the same atomic temp-file write and key validation attachments use — but it is not an
 * attachment row: nobody has to be granted access to a profile photo, there is no document
 * to purge it with, and it must be readable by an {@code <img>} tag, which cannot send a
 * bearer token. So the row keeps the photo's version and the controller serves a stable,
 * anonymously readable URL instead of a signed one that would expire in twenty minutes.
 * The quota is likewise not shared with attachments: it is one image per account, capped
 * at {@code app.profile.max-avatar-size}.
 */
@Slf4j
@Service
public class ProfileService {

    /**
     * Longest display name the profile accepts. Registration caps at 100 too, so the
     * column's 255 is never the limit a caller can reach from the UI.
     */
    static final int MAX_DISPLAY_NAME_LENGTH = 100;

    private final UserRepository userRepository;
    private final AttachmentStorage attachmentStorage;
    private final long maxAvatarBytes;
    private final TransactionTemplate transaction;

    public ProfileService(
            UserRepository userRepository,
            AttachmentStorage attachmentStorage,
            @Value("${app.profile.max-avatar-size:2MB}") DataSize maxAvatarSize,
            PlatformTransactionManager transactionManager) {
        this.userRepository = userRepository;
        this.attachmentStorage = attachmentStorage;
        this.maxAvatarBytes = maxAvatarSize.toBytes();
        this.transaction = new TransactionTemplate(transactionManager);
        this.transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /** The signed-in account, the same shape every other endpoint returns. */
    public UserResponse getProfile(UUID userId) {
        return UserResponse.from(requireUser(userId));
    }

    public UserResponse updateDisplayName(UUID userId, String displayName) {
        String normalized = normalizeDisplayName(displayName);
        return transaction.execute(status -> {
            User user = requireActiveUserForUpdate(userId);
            user.setDisplayName(normalized);
            return UserResponse.from(userRepository.save(user));
        });
    }

    /**
     * Stores the uploaded photo and points the account at it.
     *
     * <p>Deliberately not transactional, for the same reason attachment uploads are not:
     * the disk write can outlast a connection checkout. The bytes are written under a
     * fresh version key first, so a failed row update
     * can delete them and leave the previous photo intact; only after the row commits is
     * the superseded file removed.
     */
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public UserResponse replaceAvatar(UUID userId, MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "The uploaded file must not be empty.");
        }
        // Advisory, and -1 when the container does not know it: the real ceiling is
        // enforced again against the bytes that reached storage below.
        long declaredSize = Math.max(0, file.getSize());
        if (declaredSize > maxAvatarBytes) {
            throw new ApiException(ErrorCode.PAYLOAD_TOO_LARGE, sizeLimitMessage());
        }

        UUID avatarId = UUID.randomUUID();
        String storageKey = storageKey(userId, avatarId);

        StoredContent stored;
        try {
            stored = storeAvatar(storageKey, file);
        } catch (RuntimeException ex) {
            // A half-written file must never outlive the request that failed. Storage
            // itself moves atomically, so this only reclaims a complete but unwanted file.
            deleteQuietly(storageKey);
            throw ex;
        }

        if (stored.sizeBytes() > maxAvatarBytes) {
            deleteQuietly(storageKey);
            throw new ApiException(ErrorCode.PAYLOAD_TOO_LARGE, sizeLimitMessage());
        }

        AvatarChange change;
        try {
            change = transaction.execute(status -> {
                User user = requireActiveUserForUpdate(userId);
                UUID previousAvatarId = user.getAvatarId();
                user.setAvatarId(avatarId);
                user.setAvatarContentType(stored.contentType());
                return new AvatarChange(UserResponse.from(userRepository.save(user)), previousAvatarId);
            });
        } catch (RuntimeException ex) {
            deleteQuietly(storageKey);
            throw ex;
        }

        if (change.previousAvatarId() != null) {
            deleteQuietly(storageKey(userId, change.previousAvatarId()));
        }
        log.info("Profile photo updated for user {}", userId);
        return change.response();
    }

    /** Clears the uploaded photo, so the account falls back to generated initials. */
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public UserResponse removeAvatar(UUID userId) {
        AvatarChange change = transaction.execute(status -> {
            User user = requireActiveUserForUpdate(userId);
            UUID avatarId = user.getAvatarId();
            if (avatarId != null) {
                user.setAvatarId(null);
                user.setAvatarContentType(null);
                userRepository.save(user);
            }
            return new AvatarChange(UserResponse.from(user), avatarId);
        });
        if (change.previousAvatarId() != null) {
            deleteQuietly(storageKey(userId, change.previousAvatarId()));
            log.info("Profile photo removed for user {}", userId);
        }
        return change.response();
    }

    /** The stored photo of one account, for the anonymous image route. */
    public Avatar openAvatar(UUID userId) {
        User user = requireUser(userId);
        UUID avatarId = user.getAvatarId();
        if (avatarId == null) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
        String contentType =
                user.getAvatarContentType() == null ? "application/octet-stream" : user.getAvatarContentType();
        return new Avatar(attachmentStorage.open(storageKey(userId, avatarId)), contentType, avatarId.toString());
    }

    /**
     * Where a photo's bytes live. The key doubles as the version: replacing the photo
     * writes a new one, and only the row decides which key is current. The shape is
     * {@code <uuid>/<uuid>}, which is what {@code LocalAttachmentStorage} validates, so a
     * corrupted row can never name a path outside the storage directory.
     */
    private static String storageKey(UUID userId, UUID avatarId) {
        return userId + "/" + avatarId;
    }

    private User requireUser(UUID userId) {
        return userRepository.findById(userId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
    }

    private User requireActiveUserForUpdate(UUID userId) {
        User user = userRepository.findByIdForUpdate(userId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
        if (!user.isActive()) {
            throw new ApiException(ErrorCode.ACCOUNT_DISABLED);
        }
        return user;
    }

    /**
     * Collapses runs of whitespace so a name pasted from a mail client does not render as
     * a line of irregular gaps in a comment header, and rejects a blank one: the column is
     * {@code NOT NULL} and every surface that shows a person needs something to show.
     */
    private static String normalizeDisplayName(String displayName) {
        String normalized = displayName == null ? "" : displayName.strip().replaceAll("\\s+", " ");
        int length = normalized.codePointCount(0, normalized.length());
        if (length == 0 || length > MAX_DISPLAY_NAME_LENGTH) {
            throw new ApiException(
                    ErrorCode.VALIDATION_FAILED,
                    "Display name must be between 1 and " + MAX_DISPLAY_NAME_LENGTH + " characters.");
        }
        return normalized;
    }

    /**
     * Sniffs and stores one upload.
     *
     * <p>The bytes decide the type, exactly as on the attachment path: a raster label over
     * non-raster bytes is rejected, and SVG stays unsupported because it is scriptable XML.
     * One open of the multipart stream feeds both the sniff and the store, since a
     * {@link MultipartFile} need not hand out a fresh stream per call.
     */
    private StoredContent storeAvatar(String storageKey, MultipartFile file) {
        try (PushbackInputStream upload =
                new PushbackInputStream(file.getInputStream(), AttachmentContentTypes.SNIFF_BYTES)) {
            byte[] head = upload.readNBytes(AttachmentContentTypes.SNIFF_BYTES);
            upload.unread(head);
            String contentType = AttachmentContentTypes.detectRasterImageType(head);
            if (contentType == null) {
                throw new ApiException(ErrorCode.VALIDATION_FAILED, AttachmentContentTypes.UNSUPPORTED_RASTER_MESSAGE);
            }

            attachmentStorage.put(storageKey, upload);
            // The stored file, not the multipart claim, is the size that was accepted.
            StoredAttachment stored = attachmentStorage.open(storageKey);
            return new StoredContent(contentType, stored.sizeBytes());
        } catch (IOException ex) {
            throw new ApiException(ErrorCode.INTERNAL_ERROR, "Failed to read the uploaded file.");
        }
    }

    private void deleteQuietly(String storageKey) {
        try {
            attachmentStorage.delete(storageKey);
        } catch (RuntimeException ex) {
            // Orphaned bytes waste disk; failing the request over them would not help.
            log.warn("Failed to delete stored avatar {}: {}", storageKey, ex.getMessage());
        }
    }

    private String sizeLimitMessage() {
        return String.format(
                Locale.ROOT, "Profile photos must be at most %.1f MB.", maxAvatarBytes / (1024.0 * 1024.0));
    }

    private record AvatarChange(UserResponse response, UUID previousAvatarId) {}

    /** Stored bytes plus what the row records about them. */
    private record StoredContent(String contentType, long sizeBytes) {}

    /** An account's photo for the image route, plus the version the row pins it to. */
    public record Avatar(StoredAttachment stored, String contentType, String version) {}
}
