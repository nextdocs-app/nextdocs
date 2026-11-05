package com.nextdocs.api.workspace.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.nextdocs.api.audit.entity.AccessAuditAction;
import com.nextdocs.api.audit.service.AccessAuditService;
import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.workspace.dto.request.WorkspaceGroupRequest;
import com.nextdocs.api.workspace.dto.response.WorkspaceGroupResponse;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.entity.WorkspaceGroup;
import com.nextdocs.api.workspace.entity.WorkspaceGroupMember;
import com.nextdocs.api.workspace.entity.WorkspaceMember;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import com.nextdocs.api.workspace.repository.WorkspaceGroupMemberRepository;
import com.nextdocs.api.workspace.repository.WorkspaceGroupRepository;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import com.nextdocs.api.workspace.service.WorkspaceAccessService.Membership;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class WorkspaceGroupServiceTest {

    @Mock
    private WorkspaceGroupRepository groupRepository;

    @Mock
    private WorkspaceGroupMemberRepository memberRepository;

    @Mock
    private WorkspaceMemberRepository workspaceMemberRepository;

    @Mock
    private UserRepository userRepository;

    @Mock
    private WorkspaceAccessService accessService;

    @Mock
    private AccessAuditService auditService;

    private WorkspaceGroupService service;
    private UUID workspaceId;
    private UUID actorId;

    @BeforeEach
    void setUp() {
        service = new WorkspaceGroupService(
                groupRepository,
                memberRepository,
                workspaceMemberRepository,
                userRepository,
                accessService,
                auditService);
        workspaceId = UUID.randomUUID();
        actorId = UUID.randomUUID();
    }

    @Test
    void create_normalizesTheNameAndReturnsResolvedMembers() {
        UUID groupId = UUID.randomUUID();
        UUID memberId = UUID.randomUUID();
        User member = User.builder()
                .id(memberId)
                .email("member@example.com")
                .displayName("Member")
                .build();

        when(accessService.requireAdmin(actorId)).thenReturn(membership());
        when(groupRepository.existsByWorkspace_IdAndNameIgnoreCase(workspaceId, "Engineering"))
                .thenReturn(false);
        when(workspaceMemberRepository.findUserIdsByWorkspaceIdAndUserIdIn(eq(workspaceId), anyCollection()))
                .thenReturn(List.of(memberId));
        when(groupRepository.saveAndFlush(any(WorkspaceGroup.class))).thenAnswer(invocation -> {
            WorkspaceGroup group = invocation.getArgument(0);
            group.setId(groupId);
            return group;
        });
        when(memberRepository.findAllById_GroupIdIn(List.of(groupId)))
                .thenReturn(List.of(new WorkspaceGroupMember(groupId, memberId)));
        when(userRepository.findAllById(List.of(memberId))).thenReturn(List.of(member));

        WorkspaceGroupResponse response =
                service.create(actorId, new WorkspaceGroupRequest("  Engineering  ", List.of(memberId)));

        assertThat(response.id()).isEqualTo(groupId);
        assertThat(response.name()).isEqualTo("Engineering");
        assertThat(response.members()).singleElement().satisfies(row -> {
            assertThat(row.userId()).isEqualTo(memberId);
            assertThat(row.email()).isEqualTo("member@example.com");
        });
        verify(workspaceMemberRepository).findUserIdsByWorkspaceIdAndUserIdIn(eq(workspaceId), anyCollection());
        verify(auditService)
                .record(
                        workspaceId,
                        null,
                        null,
                        actorId,
                        AccessAuditAction.GROUP_CREATE,
                        "GROUP",
                        groupId,
                        "name=Engineering");
    }

    @Test
    void create_rejectsAMemberOutsideTheWorkspaceBeforeDeletingTheCurrentRoster() {
        UUID strangerId = UUID.randomUUID();
        when(accessService.requireAdmin(actorId)).thenReturn(membership());
        when(groupRepository.existsByWorkspace_IdAndNameIgnoreCase(workspaceId, "Engineering"))
                .thenReturn(false);
        when(workspaceMemberRepository.findUserIdsByWorkspaceIdAndUserIdIn(eq(workspaceId), anyCollection()))
                .thenReturn(List.of());
        when(groupRepository.saveAndFlush(any(WorkspaceGroup.class))).thenAnswer(invocation -> {
            WorkspaceGroup group = invocation.getArgument(0);
            group.setId(UUID.randomUUID());
            return group;
        });

        assertThatThrownBy(() -> service.create(actorId, new WorkspaceGroupRequest("Engineering", List.of(strangerId))))
                .isInstanceOfSatisfying(
                        ApiException.class, ex -> assertThat(ex.getErrorCode()).isEqualTo(ErrorCode.NOT_FOUND));
        verify(memberRepository, never()).deleteById_GroupId(any());
    }

    @Test
    void create_rejectsDuplicateName_throwsConflict() {
        when(accessService.requireAdmin(actorId)).thenReturn(membership());
        when(groupRepository.existsByWorkspace_IdAndNameIgnoreCase(workspaceId, "Engineering"))
                .thenReturn(true);

        assertThatThrownBy(() -> service.create(actorId, new WorkspaceGroupRequest("Engineering", List.of())))
                .isInstanceOfSatisfying(
                        ApiException.class, ex -> assertThat(ex.getErrorCode()).isEqualTo(ErrorCode.CONFLICT));
    }

    @Test
    void create_rejectsBlankName_throwsValidationFailed() {
        when(accessService.requireAdmin(actorId)).thenReturn(membership());

        assertThatThrownBy(() -> service.create(actorId, new WorkspaceGroupRequest("   ", List.of())))
                .isInstanceOfSatisfying(
                        ApiException.class, ex -> assertThat(ex.getErrorCode()).isEqualTo(ErrorCode.VALIDATION_FAILED));
    }

    @Test
    void update_renamesGroupReplacesMembersAndRecordsAudit() {
        UUID groupId = UUID.randomUUID();
        UUID newMemberId = UUID.randomUUID();
        User memberUser =
                User.builder().id(newMemberId).email("new@example.com").build();
        WorkspaceGroup group = WorkspaceGroup.builder()
                .id(groupId)
                .workspace(Workspace.builder().id(workspaceId).name("Workspace").build())
                .name("Old Name")
                .build();

        when(accessService.requireAdmin(actorId)).thenReturn(membership());
        when(groupRepository.findByIdAndWorkspace_Id(groupId, workspaceId)).thenReturn(Optional.of(group));
        when(groupRepository.existsByWorkspace_IdAndNameIgnoreCase(workspaceId, "New Name"))
                .thenReturn(false);
        when(groupRepository.saveAndFlush(group)).thenReturn(group);
        when(workspaceMemberRepository.findUserIdsByWorkspaceIdAndUserIdIn(eq(workspaceId), anyCollection()))
                .thenReturn(List.of(newMemberId));
        when(memberRepository.findAllById_GroupIdIn(List.of(groupId)))
                .thenReturn(List.of(new WorkspaceGroupMember(groupId, newMemberId)));
        when(userRepository.findAllById(List.of(newMemberId))).thenReturn(List.of(memberUser));

        WorkspaceGroupResponse response =
                service.update(actorId, groupId, new WorkspaceGroupRequest("New Name", List.of(newMemberId)));

        assertThat(response.name()).isEqualTo("New Name");
        verify(memberRepository).deleteById_GroupId(groupId);
        ArgumentCaptor<WorkspaceGroupMember> captor = ArgumentCaptor.forClass(WorkspaceGroupMember.class);
        verify(memberRepository).save(captor.capture());
        assertThat(captor.getValue().getId().getGroupId()).isEqualTo(groupId);
        assertThat(captor.getValue().getId().getUserId()).isEqualTo(newMemberId);
        verify(auditService)
                .record(
                        workspaceId,
                        null,
                        null,
                        actorId,
                        AccessAuditAction.GROUP_UPDATE,
                        "GROUP",
                        groupId,
                        "name=New Name");
    }

    @Test
    void update_rejectsDuplicateName_throwsConflict() {
        UUID groupId = UUID.randomUUID();
        WorkspaceGroup group = WorkspaceGroup.builder()
                .id(groupId)
                .workspace(Workspace.builder().id(workspaceId).name("Workspace").build())
                .name("Old Name")
                .build();

        when(accessService.requireAdmin(actorId)).thenReturn(membership());
        when(groupRepository.findByIdAndWorkspace_Id(groupId, workspaceId)).thenReturn(Optional.of(group));
        when(groupRepository.existsByWorkspace_IdAndNameIgnoreCase(workspaceId, "Existing Group"))
                .thenReturn(true);

        assertThatThrownBy(
                        () -> service.update(actorId, groupId, new WorkspaceGroupRequest("Existing Group", List.of())))
                .isInstanceOfSatisfying(
                        ApiException.class, ex -> assertThat(ex.getErrorCode()).isEqualTo(ErrorCode.CONFLICT));
    }

    @Test
    void update_rejectsAGroupFromAnotherWorkspace() {
        UUID groupId = UUID.randomUUID();
        when(accessService.requireAdmin(actorId)).thenReturn(membership());
        when(groupRepository.findByIdAndWorkspace_Id(groupId, workspaceId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.update(actorId, groupId, new WorkspaceGroupRequest("Renamed", List.of())))
                .isInstanceOfSatisfying(
                        ApiException.class, ex -> assertThat(ex.getErrorCode()).isEqualTo(ErrorCode.NOT_FOUND));
    }

    @Test
    void delete_removesMembersBeforeTheGroupRow() {
        UUID groupId = UUID.randomUUID();
        WorkspaceGroup group = WorkspaceGroup.builder()
                .id(groupId)
                .workspace(Workspace.builder().id(workspaceId).name("Workspace").build())
                .name("Engineering")
                .build();

        when(accessService.requireAdmin(actorId)).thenReturn(membership());
        when(groupRepository.findByIdAndWorkspace_Id(groupId, workspaceId)).thenReturn(Optional.of(group));

        service.delete(actorId, groupId);

        InOrder order = inOrder(memberRepository, groupRepository);
        order.verify(memberRepository).deleteById_GroupId(groupId);
        order.verify(groupRepository).delete(group);
        verify(auditService)
                .record(
                        workspaceId,
                        null,
                        null,
                        actorId,
                        AccessAuditAction.GROUP_DELETE,
                        "GROUP",
                        groupId,
                        "name=Engineering");
    }

    private Membership membership() {
        Workspace workspace =
                Workspace.builder().id(workspaceId).name("Workspace").build();
        WorkspaceMember member = WorkspaceMember.builder()
                .id(UUID.randomUUID())
                .workspace(workspace)
                .user(User.builder().id(actorId).build())
                .role(WorkspaceRole.ADMIN)
                .build();
        return new Membership(workspace, member);
    }
}
