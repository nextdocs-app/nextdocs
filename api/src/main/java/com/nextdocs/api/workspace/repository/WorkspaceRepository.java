package com.nextdocs.api.workspace.repository;

import com.nextdocs.api.workspace.entity.Workspace;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

@Repository
public interface WorkspaceRepository extends JpaRepository<Workspace, UUID> {

    /** The single workspace of this instance, if it has been created yet. */
    Optional<Workspace> findFirstByOrderByCreatedAtAsc();

    /**
     * Row-locks the workspace so role mutations serialize: two concurrent demotions
     * or removals must not both see "another owner exists" and leave zero owners.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT w FROM Workspace w WHERE w.id = :id")
    Optional<Workspace> findByIdForUpdate(@Param("id") UUID id);
}
