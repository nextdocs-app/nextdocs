package com.nextdocs.api.workspace.repository;

import com.nextdocs.api.workspace.entity.InstanceLock;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

@Repository
public interface InstanceLockRepository extends JpaRepository<InstanceLock, Short> {

    /**
     * Blocks until the singleton bootstrap lock is free, then holds it for the caller's
     * transaction. The row is seeded by V22; an absent row is a broken schema, not a
     * normal state.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT l FROM InstanceLock l WHERE l.id = 1")
    Optional<InstanceLock> lockForUpdate();
}
