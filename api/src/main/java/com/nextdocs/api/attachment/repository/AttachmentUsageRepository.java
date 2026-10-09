package com.nextdocs.api.attachment.repository;

import com.nextdocs.api.attachment.entity.AttachmentUsage;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AttachmentUsageRepository extends JpaRepository<AttachmentUsage, UUID> {

    /**
     * Row-locks the user's counter so two concurrent uploads cannot both pass the quota
     * check and then both write bytes. The caller locks the user row first, which is what
     * keeps a missing counter row from being inserted twice.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT u FROM AttachmentUsage u WHERE u.userId = :userId")
    Optional<AttachmentUsage> findForUpdate(@Param("userId") UUID userId);

    /**
     * Atomically removes {@code bytes} from the counter, flooring at zero. One UPDATE replaces
     * the read-lock-flush cycle for releases: the counter only moves down here, so the database
     * can apply the clamp in one statement. A missing row is a no-op (zero rows updated).
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE AttachmentUsage u "
            + "SET u.usedBytes = CASE WHEN u.usedBytes >= :bytes THEN u.usedBytes - :bytes ELSE 0 END "
            + "WHERE u.userId = :userId")
    int decrement(@Param("userId") UUID userId, @Param("bytes") long bytes);
}
