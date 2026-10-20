package com.nextdocs.api.workspace.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.entity.WorkspaceMember;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class WorkspaceAccessServiceTest {

    @Mock
    private WorkspaceMemberRepository memberRepository;

    @InjectMocks
    private WorkspaceAccessService accessService;

    private UUID userId;
    private WorkspaceMember member;

    @BeforeEach
    void setUp() {
        userId = UUID.randomUUID();
        Workspace workspace =
                Workspace.builder().id(UUID.randomUUID()).name("NextDocs").build();
        User user = User.builder().email("user@example.com").displayName("User").build();
        user.setId(userId);
        member = WorkspaceMember.builder()
                .workspace(workspace)
                .user(user)
                .role(WorkspaceRole.MEMBER)
                .build();
    }

    private void membershipWithRole(WorkspaceRole role) {
        member.setRole(role);
        when(memberRepository.findByUserId(userId)).thenReturn(Optional.of(member));
    }

    @Test
    void requireMember_throwsNotFoundWhenTheUserHasNoMembership() {
        when(memberRepository.findByUserId(userId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> accessService.requireMember(userId))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.NOT_FOUND));
    }

    @Test
    void requireMember_returnsWorkspaceAndMembership() {
        membershipWithRole(WorkspaceRole.MEMBER);

        WorkspaceAccessService.Membership membership = accessService.requireMember(userId);

        assertThat(membership.member()).isSameAs(member);
        assertThat(membership.workspace()).isSameAs(member.getWorkspace());
    }

    @Test
    void requireAdmin_allowsOwnersAndAdmins() {
        membershipWithRole(WorkspaceRole.ADMIN);
        assertThat(accessService.requireAdmin(userId).member().getRole()).isEqualTo(WorkspaceRole.ADMIN);

        member.setRole(WorkspaceRole.OWNER);
        assertThat(accessService.requireAdmin(userId).member().getRole()).isEqualTo(WorkspaceRole.OWNER);
    }

    @Test
    void requireAdmin_rejectsPlainMembers() {
        membershipWithRole(WorkspaceRole.MEMBER);

        assertThatThrownBy(() -> accessService.requireAdmin(userId))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.FORBIDDEN));
    }

    @Test
    void requireOwner_allowsOwners() {
        membershipWithRole(WorkspaceRole.OWNER);

        assertThat(accessService.requireOwner(userId).member().getRole()).isEqualTo(WorkspaceRole.OWNER);
    }

    @Test
    void requireOwner_rejectsAdmins() {
        membershipWithRole(WorkspaceRole.ADMIN);

        assertThatThrownBy(() -> accessService.requireOwner(userId))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.FORBIDDEN));
    }

    @Test
    void isInitialized_reflectsWhetherAnyMembershipExists() {
        when(memberRepository.count()).thenReturn(0L);
        assertThat(accessService.isInitialized()).isFalse();

        when(memberRepository.count()).thenReturn(1L);
        assertThat(accessService.isInitialized()).isTrue();
    }
}
