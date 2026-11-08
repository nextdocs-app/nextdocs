package com.nextdocs.api.realtime.repository;

import com.nextdocs.api.realtime.entity.YhubPurgeOutbox;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface YhubPurgeOutboxRepository extends JpaRepository<YhubPurgeOutbox, UUID> {

    List<YhubPurgeOutbox> findTop50ByCompletedAtIsNullAndNextAttemptAtLessThanEqualOrderByNextAttemptAtAsc(
            OffsetDateTime now);

    /**
     * Whether this id was ever purged. Completed rows are the permanent reservation for a
     * document id: Yhub keeps a hard tombstone, so the id can never host a room again.
     */
    boolean existsByDocumentId(UUID documentId);
}
