package com.nextdocs.api.realtime.repository;

import com.nextdocs.api.realtime.entity.YhubPurgeOutbox;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

@Repository
public interface YhubPurgeOutboxRepository extends JpaRepository<YhubPurgeOutbox, UUID> {

    List<YhubPurgeOutbox> findTop50ByCompletedAtIsNullAndNextAttemptAtLessThanEqualOrderByNextAttemptAtAsc(
            OffsetDateTime now);

    @Modifying
    @Query("DELETE FROM YhubPurgeOutbox o WHERE o.completedAt IS NOT NULL AND o.completedAt < :cutoff")
    int deleteCompletedBefore(@Param("cutoff") OffsetDateTime cutoff);
}
