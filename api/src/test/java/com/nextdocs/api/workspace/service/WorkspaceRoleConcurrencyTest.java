package com.nextdocs.api.workspace.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doAnswer;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.RefreshTokenRepository;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.workspace.dto.request.WorkspaceMemberRoleUpdateRequest;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.entity.WorkspaceMember;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import com.nextdocs.api.workspace.repository.WorkspaceRepository;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The role check runs before the workspace lock, so a demotion that commits while the
 * mutation waits for that lock must be re-read. Unit tests hand the service a mocked
 * membership and cannot see this race; these racers use two real transactions.
 */
@SpringBootTest
class WorkspaceRoleConcurrencyTest {

    @Autowired
    private WorkspaceService workspaceService;

    @Autowired
    private WorkspaceRepository workspaceRepository;

    @Autowired
    private WorkspaceMemberRepository memberRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private RefreshTokenRepository refreshTokenRepository;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @MockitoSpyBean
    private WorkspaceAccessService accessService;

    private Workspace workspace;
    private User actor;
    private User target;

    @BeforeEach
    void seedWorkspace() {
        actor = userRepository.saveAndFlush(User.builder()
                .email("race-actor@example.com")
                .displayName("Actor")
                .build());
        target = userRepository.saveAndFlush(User.builder()
                .email("race-target@example.com")
                .displayName("Target")
                .build());
        workspace = workspaceRepository.saveAndFlush(
                Workspace.builder().name("Race").build());
        member(actor, WorkspaceRole.OWNER);
        member(target, WorkspaceRole.MEMBER);
    }

    @AfterEach
    void removeCreatedRows() {
        refreshTokenRepository.deleteAll();
        memberRepository.deleteAll();
        workspaceRepository.deleteAll();
        userRepository.deleteAll();
    }

    @Test
    void demotedOwnerCannotChangeRolesAfterWaitingForTheLock() throws Exception {
        CountDownLatch actorLoaded = new CountDownLatch(1);
        doAnswer(invocation -> {
                    Object result = invocation.callRealMethod();
                    actorLoaded.countDown();
                    return result;
                })
                .when(accessService)
                .requireOwner(actor.getId());

        ErrorCode outcome = runWhileDemotingActor(
                actorLoaded,
                () -> workspaceService.updateMemberRole(
                        actor.getId(), target.getId(), new WorkspaceMemberRoleUpdateRequest("ADMIN")));

        assertThat(outcome).isEqualTo(ErrorCode.FORBIDDEN);
        assertThat(memberRepository.findByUserId(target.getId()).orElseThrow().getRole())
                .isEqualTo(WorkspaceRole.MEMBER);
    }

    @Test
    void demotedAdminCannotRemoveAMemberAfterWaitingForTheLock() throws Exception {
        WorkspaceMember actorMember =
                memberRepository.findByUserId(actor.getId()).orElseThrow();
        actorMember.setRole(WorkspaceRole.ADMIN);
        memberRepository.saveAndFlush(actorMember);

        CountDownLatch actorLoaded = new CountDownLatch(1);
        doAnswer(invocation -> {
                    Object result = invocation.callRealMethod();
                    actorLoaded.countDown();
                    return result;
                })
                .when(accessService)
                .requireAdmin(actor.getId());

        ErrorCode outcome =
                runWhileDemotingActor(actorLoaded, () -> workspaceService.removeMember(actor.getId(), target.getId()));

        assertThat(outcome).isEqualTo(ErrorCode.FORBIDDEN);
        assertThat(memberRepository.findByUserId(target.getId())).isPresent();
    }

    /**
     * Holds the workspace lock and demotes the actor in one transaction, then starts the
     * mutation so its access check sees the old role and its lock waits. The mutation's
     * outcome is collected after the demotion commits.
     */
    private ErrorCode runWhileDemotingActor(CountDownLatch actorLoaded, Runnable mutation) throws Exception {
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            AtomicReference<Future<ErrorCode>> outcome = new AtomicReference<>();
            new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
                workspaceRepository.findByIdForUpdate(workspace.getId()).orElseThrow();
                WorkspaceMember actorMember =
                        memberRepository.findByUserId(actor.getId()).orElseThrow();
                actorMember.setRole(WorkspaceRole.MEMBER);
                memberRepository.saveAndFlush(actorMember);

                outcome.set(pool.submit(() -> {
                    try {
                        mutation.run();
                        return null;
                    } catch (ApiException ex) {
                        return ex.getErrorCode();
                    }
                }));
                try {
                    assertThat(actorLoaded.await(10, TimeUnit.SECONDS)).isTrue();
                } catch (InterruptedException ex) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException(ex);
                }
            });
            return outcome.get().get(30, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }
    }

    private WorkspaceMember member(User user, WorkspaceRole role) {
        return memberRepository.saveAndFlush(WorkspaceMember.builder()
                .workspace(workspace)
                .user(user)
                .role(role)
                .build());
    }
}
