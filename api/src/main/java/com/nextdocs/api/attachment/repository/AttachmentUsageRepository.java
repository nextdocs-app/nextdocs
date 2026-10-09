package com.nextdocs.api.attachment.repository;

import com.nextdocs.api.attachment.entity.AttachmentUsage;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
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
}
