package com.nextdocs.api.space.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.space.entity.Space;
import com.nextdocs.api.space.entity.SpaceAccessMode;
import com.nextdocs.api.space.entity.SpaceMember;
import com.nextdocs.api.space.repository.SpaceMemberRepository;
import com.nextdocs.api.space.repository.SpaceRepository;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.entity.WorkspaceMember;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import com.nextdocs.api.workspace.service.WorkspaceAccessService;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class SpaceAccessServiceTest {

    @Mock
    private SpaceRepository spaceRepository;

    @Mock
    private SpaceMemberRepository memberRepository;

    @Mock
    private WorkspaceAccessService workspaceAccessService;

    @InjectMocks
    private SpaceAccessService accessService;

    private UUID userId;
    private Workspace workspace;
    private WorkspaceMember workspaceMember;
    private Space space;

    @BeforeEach
    void setUp() {
        userId = UUID.randomUUID();
        workspace = Workspace.builder().id(UUID.randomUUID()).name("NextDocs").build();
        User user = User.builder().email("user@example.com").displayName("User").build();
        user.setId(userId);
        workspaceMember = WorkspaceMember.builder()
                .workspace(workspace)
                .user(user)
                .role(WorkspaceRole.MEMBER)
                .build();
        space = Space.builder()
                .id(UUID.randomUUID())
                .workspace(workspace)
                .name("Engineering")
                .accessMode(SpaceAccessMode.CUSTOM)
                .everyoneAccessLevel(DocumentAccessLevel.VIEW)
                .build();
    }

    private void authorize(WorkspaceRole role) {
        workspaceMember.setRole(role);
        when(workspaceAccessService.requireMember(userId))
                .thenReturn(new WorkspaceAccessService.Membership(workspace, workspaceMember));
        when(spaceRepository.findByIdAndWorkspace_Id(space.getId(), workspace.getId()))
                .thenReturn(Optional.of(space));
    }

    private void memberWithLevel(DocumentAccessLevel level) {
        SpaceMember member = SpaceMember.builder()
                .space(space)
                .user(workspaceMember.getUser())
                .accessLevel(level)
                .build();
        when(memberRepository.findBySpace_IdAndUser_Id(space.getId(), userId)).thenReturn(Optional.of(member));
    }

    @Test
    void load_masksASpaceOfAnotherWorkspaceAsNotFound() {
        when(workspaceAccessService.requireMember(userId))
                .thenReturn(new WorkspaceAccessService.Membership(workspace, workspaceMember));
        when(spaceRepository.findByIdAndWorkspace_Id(space.getId(), workspace.getId()))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> accessService.load(userId, space.getId()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.NOT_FOUND));
    }

    @Test
    void load_memberLevelIsTheContentGrant() {
        authorize(WorkspaceRole.MEMBER);
        memberWithLevel(DocumentAccessLevel.EDIT);

        SpaceAccessService.SpaceContext context = accessService.load(userId, space.getId());

        assertThat(context.accessLevel()).isEqualTo(DocumentAccessLevel.EDIT);
        assertThat(context.canAdminister()).isFalse();
    }

    @Test
    void load_publicSpaceFallsBackToTheEveryoneLevel() {
        authorize(WorkspaceRole.MEMBER);
        space.setAccessMode(SpaceAccessMode.PUBLIC);
        space.setEveryoneAccessLevel(DocumentAccessLevel.COMMENT);

        SpaceAccessService.SpaceContext context = accessService.load(userId, space.getId());

        assertThat(context.accessLevel()).isEqualTo(DocumentAccessLevel.COMMENT);
        assertThat(context.canAdminister()).isFalse();
    }

    @Test
    void load_workspaceAdminAdministersAnySpaceWithoutContentAccess() {
        authorize(WorkspaceRole.ADMIN);

        SpaceAccessService.SpaceContext context = accessService.load(userId, space.getId());

        assertThat(context.accessLevel()).isNull();
        assertThat(context.canAdminister()).isTrue();
        // Content read stays separate from administration.
        assertThatThrownBy(() -> accessService.requireContentRead(userId, space.getId()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.NOT_FOUND));
    }

    @Test
    void spaceOwnerAdministersTheirOwnSpace() {
        authorize(WorkspaceRole.MEMBER);
        memberWithLevel(DocumentAccessLevel.OWNER);

        SpaceAccessService.SpaceContext context = accessService.requireAdministration(userId, space.getId());

        assertThat(context.canAdminister()).isTrue();
        assertThat(context.workspaceAdmin()).isFalse();
    }

    @Test
    void requireAdministration_forbiddenWhenTheCallerHasALevelButNotOwnership() {
        authorize(WorkspaceRole.MEMBER);
        memberWithLevel(DocumentAccessLevel.EDIT);

        assertThatThrownBy(() -> accessService.requireAdministration(userId, space.getId()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.FORBIDDEN));
    }

    @Test
    void requireAdministration_masksAStrangerAsNotFound() {
        authorize(WorkspaceRole.MEMBER);

        assertThatThrownBy(() -> accessService.requireAdministration(userId, space.getId()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.NOT_FOUND));
    }

    @Test
    void requireEdit_rejectsViewOnlyMembers() {
        authorize(WorkspaceRole.MEMBER);
        memberWithLevel(DocumentAccessLevel.VIEW);

        assertThatThrownBy(() -> accessService.requireEdit(userId, space.getId()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.FORBIDDEN));
    }

    @Test
    void requireRead_admitsAnyLevel() {
        authorize(WorkspaceRole.MEMBER);
        memberWithLevel(DocumentAccessLevel.VIEW);

        assertThat(accessService.requireRead(userId, space.getId()).accessLevel())
                .isEqualTo(DocumentAccessLevel.VIEW);
    }
}
