package com.nextdocs.api.space.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.space.entity.Space;
import com.nextdocs.api.space.entity.SpaceAccessMode;
import com.nextdocs.api.space.entity.SpaceMember;
import com.nextdocs.api.space.repository.SpaceMemberRepository;
import com.nextdocs.api.space.repository.SpaceRepository;
import com.nextdocs.api.user.entity.User;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.entity.WorkspaceMember;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import com.nextdocs.api.workspace.service.WorkspaceAccessService;
import java.time.OffsetDateTime;
import java.util.List;
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

        User user = User.builder()
                .email("user@example.com")
                .displayName("User")
                .passwordHash("$2a$12$hash")
                .build();

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

    private void callerViewingSpaces(WorkspaceRole role) {
        workspaceMember.setRole(role);
        when(workspaceAccessService.findMember(userId))
                .thenReturn(Optional.of(new WorkspaceAccessService.Membership(workspace, workspaceMember)));
    }

    private SpaceMember memberOf(Space joined, DocumentAccessLevel level) {
        return SpaceMember.builder()
                .space(joined)
                .user(workspaceMember.getUser())
                .accessLevel(level)
                .build();
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
    void load_publicSpaceNeverLowersAListedMember() {
        authorize(WorkspaceRole.MEMBER);
        space.setAccessMode(SpaceAccessMode.PUBLIC);
        space.setEveryoneAccessLevel(DocumentAccessLevel.VIEW);
        memberWithLevel(DocumentAccessLevel.EDIT);

        assertThat(accessService.load(userId, space.getId()).accessLevel()).isEqualTo(DocumentAccessLevel.EDIT);
    }

    @Test
    void load_publicSpaceDefaultWinsWhenHigherThanExplicitMembership() {
        authorize(WorkspaceRole.MEMBER);
        space.setAccessMode(SpaceAccessMode.PUBLIC);
        space.setEveryoneAccessLevel(DocumentAccessLevel.EDIT);
        memberWithLevel(DocumentAccessLevel.VIEW);

        assertThat(accessService.load(userId, space.getId()).accessLevel()).isEqualTo(DocumentAccessLevel.EDIT);
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
    void requireEdit_rejectsAnArchivedSpaceEvenForAnEditor() {
        authorize(WorkspaceRole.MEMBER);
        memberWithLevel(DocumentAccessLevel.EDIT);
        space.setArchivedAt(OffsetDateTime.now());

        assertThatThrownBy(() -> accessService.requireEdit(userId, space.getId()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.CONFLICT));
    }

    @Test
    void requireActiveAdministration_rejectsAnArchivedSpace() {
        authorize(WorkspaceRole.MEMBER);
        memberWithLevel(DocumentAccessLevel.OWNER);
        space.setArchivedAt(OffsetDateTime.now());

        assertThatThrownBy(() -> accessService.requireActiveAdministration(userId, space.getId()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.CONFLICT));
    }

    @Test
    void requireAdministration_stillAdmitsAnArchivedSpaceForRestoreAndDelete() {
        authorize(WorkspaceRole.MEMBER);
        memberWithLevel(DocumentAccessLevel.OWNER);
        space.setArchivedAt(OffsetDateTime.now());

        assertThat(accessService.requireAdministration(userId, space.getId()).canAdminister())
                .isTrue();
    }

    @Test
    void requireRead_stillAdmitsAnArchivedSpace() {
        authorize(WorkspaceRole.MEMBER);
        memberWithLevel(DocumentAccessLevel.VIEW);
        space.setArchivedAt(OffsetDateTime.now());

        assertThat(accessService.requireRead(userId, space.getId()).accessLevel())
                .isEqualTo(DocumentAccessLevel.VIEW);
    }

    @Test
    void requireRead_admitsAnyLevel() {
        authorize(WorkspaceRole.MEMBER);
        memberWithLevel(DocumentAccessLevel.VIEW);

        assertThat(accessService.requireRead(userId, space.getId()).accessLevel())
                .isEqualTo(DocumentAccessLevel.VIEW);
    }

    @Test
    void requireRoster_admitsAListedMember() {
        authorize(WorkspaceRole.MEMBER);
        memberWithLevel(DocumentAccessLevel.VIEW);
        when(memberRepository.existsBySpace_IdAndUser_Id(space.getId(), userId)).thenReturn(true);

        assertThat(accessService.requireRoster(userId, space.getId()).accessLevel())
                .isEqualTo(DocumentAccessLevel.VIEW);
    }

    @Test
    void requireRoster_admitsAWorkspaceAdminWhoIsNotAMember() {
        authorize(WorkspaceRole.OWNER);

        assertThat(accessService.requireRoster(userId, space.getId()).workspaceAdmin())
                .isTrue();
    }

    @Test
    void requireRoster_rejectsAPublicReaderWhoIsNotAMember() {
        authorize(WorkspaceRole.MEMBER);
        space.setAccessMode(SpaceAccessMode.PUBLIC);

        // Reading the space is allowed, enumerating who is in it is not.
        assertThat(accessService.requireRead(userId, space.getId()).accessLevel())
                .isEqualTo(DocumentAccessLevel.VIEW);
        assertThatThrownBy(() -> accessService.requireRoster(userId, space.getId()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.FORBIDDEN));
    }

    @Test
    void requireRoster_masksAnInvisibleSpaceAsNotFound() {
        authorize(WorkspaceRole.MEMBER);

        assertThatThrownBy(() -> accessService.requireRoster(userId, space.getId()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.NOT_FOUND));
    }

    @Test
    void visibleSpaceIds_includesMembershipsAndPublicSpacesButNotStrangersCustomSpaces() {
        callerViewingSpaces(WorkspaceRole.MEMBER);
        Space publicSpace = Space.builder()
                .id(UUID.randomUUID())
                .workspace(workspace)
                .name("Handbook")
                .accessMode(SpaceAccessMode.PUBLIC)
                .everyoneAccessLevel(DocumentAccessLevel.VIEW)
                .build();
        Space joined = Space.builder()
                .id(UUID.randomUUID())
                .workspace(workspace)
                .name("Design")
                .accessMode(SpaceAccessMode.CUSTOM)
                .build();
        Space someoneElses = Space.builder()
                .id(UUID.randomUUID())
                .workspace(workspace)
                .name("Executive")
                .accessMode(SpaceAccessMode.CUSTOM)
                .build();
        when(memberRepository.findAllByUser_Id(userId)).thenReturn(List.of(memberOf(joined, DocumentAccessLevel.VIEW)));

        assertThat(accessService.visibleSpaceIds(userId, List.of(space, publicSpace, joined, someoneElses)))
                .containsExactlyInAnyOrder(publicSpace.getId(), joined.getId());
    }

    @Test
    void visibleSpaceIds_admitsAWorkspaceAdminToASpaceTheyNeverJoined() {
        authorize(WorkspaceRole.ADMIN);
        callerViewingSpaces(WorkspaceRole.ADMIN);

        // The space list already shows an admin every space, so naming one in a
        // breadcrumb discloses nothing they cannot navigate to. Naming a space is not
        // reading it: the content gate still has no level for a non-member admin.
        assertThat(accessService.visibleSpaceIds(userId, List.of(space))).containsExactly(space.getId());
        assertThatThrownBy(() -> accessService.requireContentRead(userId, space.getId()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.NOT_FOUND));
    }

    @Test
    void visibleSpaceIds_hidesASpaceOfAnotherWorkspaceEvenFromAnAdmin() {
        callerViewingSpaces(WorkspaceRole.OWNER);
        Space foreign = Space.builder()
                .id(UUID.randomUUID())
                .workspace(
                        Workspace.builder().id(UUID.randomUUID()).name("Other").build())
                .name("Other Workspace Space")
                .accessMode(SpaceAccessMode.PUBLIC)
                .everyoneAccessLevel(DocumentAccessLevel.VIEW)
                .build();

        assertThat(accessService.visibleSpaceIds(userId, List.of(foreign))).isEmpty();
    }

    @Test
    void visibleSpaceIds_isEmptyWithoutAWorkspaceMembership() {
        when(workspaceAccessService.findMember(userId)).thenReturn(Optional.empty());

        assertThat(accessService.visibleSpaceIds(userId, List.of(space))).isEmpty();
    }
}
