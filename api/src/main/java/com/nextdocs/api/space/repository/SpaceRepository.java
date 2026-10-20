package com.nextdocs.api.space.repository;

import com.nextdocs.api.space.entity.Space;
import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

@Repository
public interface SpaceRepository extends JpaRepository<Space, UUID> {

    /** Every space of a workspace, oldest first: the sidebar's stable base order. */
    List<Space> findAllByWorkspace_IdOrderByCreatedAtAsc(UUID workspaceId);

    /**
     * Spaces a plain member can see: the ones they are listed on plus every PUBLIC space.
     * Public is resolved from the mode alone — a PUBLIC space is readable by the whole
     * workspace whatever its everyone-else level is.
     */
    @Query("SELECT s FROM Space s "
            + "WHERE s.workspace.id = :workspaceId "
            + "AND (s.accessMode = com.nextdocs.api.space.entity.SpaceAccessMode.PUBLIC "
            + "     OR EXISTS (SELECT 1 FROM SpaceMember m WHERE m.space.id = s.id AND m.user.id = :userId)) "
            + "ORDER BY s.createdAt ASC, s.id ASC")
    List<Space> findAllVisibleToUser(@Param("workspaceId") UUID workspaceId, @Param("userId") UUID userId);

    Optional<Space> findByIdAndWorkspace_Id(UUID id, UUID workspaceId);

    /**
     * Row-locks the space so role mutations serialize: two concurrent owner demotions
     * or removals must not both observe "another owner exists" and leave zero owners.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT s FROM Space s WHERE s.id = :id")
    Optional<Space> findByIdForUpdate(@Param("id") UUID id);
}
