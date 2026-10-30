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

    /** Active spaces of a workspace, oldest first: the workspace roster's space list. */
    List<Space> findAllByWorkspace_IdAndArchivedAtIsNullOrderByCreatedAtAsc(UUID workspaceId);

    /**
     * Every active space of the workspace, in the caller's personal order: the sidebar a
     * workspace admin sees. Spaces without an order row (new to the caller, or created
     * before personal ordering existed) sort after the ordered ones by creation time,
     * which keeps a stable base order until the caller moves one.
     */
    @Query("SELECT s FROM Space s "
            + "LEFT JOIN UserSpaceOrder uso ON uso.space.id = s.id AND uso.user.id = :userId "
            + "WHERE s.workspace.id = :workspaceId AND s.archivedAt IS NULL "
            + "ORDER BY CASE WHEN uso.orderKey IS NULL THEN 1 ELSE 0 END, uso.orderKey ASC, "
            + "s.createdAt ASC, s.id ASC")
    List<Space> findAllActiveForUser(@Param("workspaceId") UUID workspaceId, @Param("userId") UUID userId);

    /** Archived spaces of a workspace, newest archive first: the restore view. */
    List<Space> findAllByWorkspace_IdAndArchivedAtIsNotNullOrderByArchivedAtDescIdDesc(UUID workspaceId);

    /**
     * Archived spaces of a workspace the caller owns, newest archive first. A plain member
     * may only restore the spaces they own, so the ownership filter belongs in SQL.
     */
    @Query("SELECT s FROM Space s "
            + "WHERE s.workspace.id = :workspaceId "
            + "AND s.archivedAt IS NOT NULL "
            + "AND EXISTS (SELECT 1 FROM SpaceMember m WHERE m.space.id = s.id "
            + "     AND m.user.id = :userId "
            + "     AND m.accessLevel = com.nextdocs.api.document.entity.DocumentAccessLevel.OWNER) "
            + "ORDER BY s.archivedAt DESC, s.id DESC")
    List<Space> findArchivedOwnedByUser(@Param("workspaceId") UUID workspaceId, @Param("userId") UUID userId);

    /**
     * Spaces a plain member can see: the ones they are listed on plus every PUBLIC space,
     * in the caller's personal order. Public is resolved from the mode alone — a PUBLIC
     * space is readable by the whole workspace whatever its everyone-else level is.
     * Archived spaces are hidden from normal navigation and listed separately.
     */
    @Query("SELECT s FROM Space s "
            + "LEFT JOIN UserSpaceOrder uso ON uso.space.id = s.id AND uso.user.id = :userId "
            + "WHERE s.workspace.id = :workspaceId "
            + "AND s.archivedAt IS NULL "
            + "AND (s.accessMode = com.nextdocs.api.space.entity.SpaceAccessMode.PUBLIC "
            + "     OR EXISTS (SELECT 1 FROM SpaceMember m WHERE m.space.id = s.id AND m.user.id = :userId)) "
            + "ORDER BY CASE WHEN uso.orderKey IS NULL THEN 1 ELSE 0 END, uso.orderKey ASC, "
            + "s.createdAt ASC, s.id ASC")
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
