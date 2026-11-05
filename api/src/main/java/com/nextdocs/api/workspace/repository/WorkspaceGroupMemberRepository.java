package com.nextdocs.api.workspace.repository;

import com.nextdocs.api.workspace.entity.WorkspaceGroupMember;
import com.nextdocs.api.workspace.entity.WorkspaceGroupMemberId;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface WorkspaceGroupMemberRepository extends JpaRepository<WorkspaceGroupMember, WorkspaceGroupMemberId> {

    List<WorkspaceGroupMember> findAllById_GroupIdIn(Collection<UUID> groupIds);

    boolean existsById_GroupIdAndId_UserId(UUID groupId, UUID userId);

    void deleteById_GroupId(UUID groupId);

    void deleteById_UserId(UUID userId);
}
