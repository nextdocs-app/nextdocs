package com.nextdocs.api.workspace.entity;

import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** One user's membership in a workspace group. */
@Entity
@Table(name = "workspace_group_members")
@Getter
@Setter
@NoArgsConstructor
public class WorkspaceGroupMember {

    @EmbeddedId
    private WorkspaceGroupMemberId id;

    public WorkspaceGroupMember(UUID groupId, UUID userId) {
        this.id = new WorkspaceGroupMemberId(groupId, userId);
    }
}
