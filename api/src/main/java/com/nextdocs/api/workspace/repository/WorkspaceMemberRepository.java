package com.nextdocs.api.workspace.repository;

import com.nextdocs.api.workspace.entity.WorkspaceMember;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface WorkspaceMemberRepository extends JpaRepository<WorkspaceMember, UUID> {

    /** The caller's membership, since an instance has exactly one workspace. */
    Optional<WorkspaceMember> findByUserId(UUID userId);

    List<WorkspaceMember> findAllByWorkspaceIdOrderByCreatedAtAsc(UUID workspaceId);

    Optional<WorkspaceMember> findByWorkspaceIdAndUserId(UUID workspaceId, UUID userId);

    long countByWorkspaceId(UUID workspaceId);

    long countByWorkspaceIdAndRole(UUID workspaceId, WorkspaceRole role);

    boolean existsByWorkspaceIdAndUserId(UUID workspaceId, UUID userId);
}
