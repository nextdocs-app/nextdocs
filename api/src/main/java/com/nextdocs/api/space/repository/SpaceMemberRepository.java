package com.nextdocs.api.space.repository;

import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.space.entity.SpaceMember;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

@Repository
public interface SpaceMemberRepository extends JpaRepository<SpaceMember, UUID> {

    /** Roster for one space; the user is fetched with the row the caller always reads. */
    @EntityGraph(attributePaths = "user")
    List<SpaceMember> findAllBySpace_IdOrderByCreatedAtAsc(UUID spaceId);

    /** Every space membership across a workspace, with space and user attached. */
    @EntityGraph(attributePaths = {"space", "user"})
    List<SpaceMember> findAllBySpace_Workspace_Id(UUID workspaceId);

    /**
     * Every membership of one user, with the space attached: the visible-space listing
     * and the workspace off-boarding cleanup both need the space, never a lazy load per row.
     */
    @EntityGraph(attributePaths = "space")
    List<SpaceMember> findAllByUser_Id(UUID userId);

    Optional<SpaceMember> findBySpace_IdAndUser_Id(UUID spaceId, UUID userId);

    boolean existsBySpace_IdAndUser_Id(UUID spaceId, UUID userId);

    long countBySpace_Id(UUID spaceId);

    long countBySpace_IdAndAccessLevel(UUID spaceId, DocumentAccessLevel accessLevel);

    /** Member counts per space in one query, for the space listing. */
    @Query("SELECT m.space.id, COUNT(m) FROM SpaceMember m " + "WHERE m.space.id IN :spaceIds GROUP BY m.space.id")
    List<Object[]> countMembersBySpaceIds(@Param("spaceIds") Collection<UUID> spaceIds);

    /**
     * Drops every space membership of a user who left the workspace. Their page access
     * then resolves from PUBLIC space grants only, never from a stale membership row.
     *
     * <p>Deliberately no {@code clearAutomatically}: the caller removes the workspace
     * membership in the same transaction and still holds that member's user entity, so
     * clearing the context here would detach it mid-flight. No SpaceMember entity is
     * loaded by that path, so nothing stale is left behind to flush.
     */
    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM SpaceMember m WHERE m.user.id = :userId")
    int deleteByUser_Id(@Param("userId") UUID userId);
}
