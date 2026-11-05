package com.nextdocs.api.workspace.repository;

import com.nextdocs.api.workspace.entity.WorkspaceGroup;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface WorkspaceGroupRepository extends JpaRepository<WorkspaceGroup, UUID> {

    List<WorkspaceGroup> findAllByWorkspace_IdOrderByNameAsc(UUID workspaceId);

    Optional<WorkspaceGroup> findByIdAndWorkspace_Id(UUID id, UUID workspaceId);

    boolean existsByWorkspace_IdAndNameIgnoreCase(UUID workspaceId, String name);
}
