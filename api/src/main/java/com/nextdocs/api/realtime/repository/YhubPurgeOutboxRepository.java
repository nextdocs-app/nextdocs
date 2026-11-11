package com.nextdocs.api.realtime.repository;

import com.nextdocs.api.realtime.entity.YhubPurgeOutbox;
import jakarta.persistence.LockModeType;
import jakarta.persistence.QueryHint;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.QueryHints;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

@Repository
public interface YhubPurgeOutboxRepository extends JpaRepository<YhubPurgeOutbox, UUID> {

    /**
     * Pending rows for one drain, locked so two replicas cannot both hard-delete the
     * same document. {@code SKIP LOCKED} (the {@code -2} timeout hint) makes the second
     * drainer move on to other rows instead of waiting for the first to commit; a
     * duplicate delete is wasteful, not wrong, but it also doubles the retry budget.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @QueryHints(@QueryHint(name = "jakarta.persistence.lock.timeout", value = "-2"))
    @Query("SELECT o FROM YhubPurgeOutbox o "
            + "WHERE o.completedAt IS NULL AND o.nextAttemptAt <= :now "
            + "ORDER BY o.nextAttemptAt ASC")
    List<YhubPurgeOutbox> findPendingForUpdate(@Param("now") OffsetDateTime now, Pageable pageable);

    /**
     * Whether this id was ever purged. Completed rows are the permanent reservation for a
     * document id: Yhub keeps a hard tombstone, so the id can never host a room again.
     */
    boolean existsByDocumentId(UUID documentId);
}
