package com.nextdocs.api.workspace.repository;

import com.nextdocs.api.workspace.entity.WorkspaceMember;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface WorkspaceMemberRepository extends JpaRepository<WorkspaceMember, UUID> {

    /**
     * The caller's membership, since an instance has exactly one workspace.
     *
     * <p>The user and workspace are fetched in the same query: the auth filter is the
     * per-request session gate (live membership plus {@code isActive}) and runs outside
     * any transaction, so a lazy association would blow up or issue a second select on
     * access.
     */
    @EntityGraph(attributePaths = {"user", "workspace"})
    Optional<WorkspaceMember> findByUserId(UUID userId);

    @EntityGraph(attributePaths = "user")
    List<WorkspaceMember> findAllByWorkspaceIdOrderByCreatedAtAsc(UUID workspaceId);

    Optional<WorkspaceMember> findByWorkspaceIdAndUserId(UUID workspaceId, UUID userId);

    long countByWorkspaceId(UUID workspaceId);

    long countByWorkspaceIdAndRole(UUID workspaceId, WorkspaceRole role);

    boolean existsByWorkspaceIdAndUserId(UUID workspaceId, UUID userId);
}
