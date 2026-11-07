package com.nextdocs.api.realtime.repository;

import com.nextdocs.api.realtime.entity.YhubProjectionState;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

@Repository
public interface YhubProjectionStateRepository extends JpaRepository<YhubProjectionState, Short> {

    /**
     * Take the writer lease only when it is free or expired. One statement, so two
     * instances cannot both observe a free lease.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE YhubProjectionState s "
            + "SET s.leaseOwner = :owner, s.leaseExpiresAt = :expiresAt "
            + "WHERE s.id = 1 "
            + "AND (s.leaseOwner IS NULL OR s.leaseExpiresAt IS NULL OR s.leaseExpiresAt < :now)")
    int tryAcquire(
            @Param("owner") UUID owner, @Param("now") OffsetDateTime now, @Param("expiresAt") OffsetDateTime expiresAt);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE YhubProjectionState s "
            + "SET s.leaseOwner = NULL, s.leaseExpiresAt = NULL "
            + "WHERE s.id = 1 AND s.leaseOwner = :owner")
    int release(@Param("owner") UUID owner);

    /**
     * Advance the cursor and drop the lease atomically, and only while this instance
     * still holds it. A sweeper that took over must not be overwritten.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE YhubProjectionState s "
            + "SET s.cursor = :cursor, s.lastSuccessAt = :now, s.updatedAt = :now, "
            + "s.leaseOwner = NULL, s.leaseExpiresAt = NULL "
            + "WHERE s.id = 1 AND s.leaseOwner = :owner")
    int advance(@Param("owner") UUID owner, @Param("cursor") long cursor, @Param("now") OffsetDateTime now);
}
