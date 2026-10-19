package com.nextdocs.api.workspace.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.workspace.dto.request.WorkspaceInviteCreateRequest;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.entity.WorkspaceMember;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import com.nextdocs.api.workspace.repository.WorkspaceInviteRepository;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import com.nextdocs.api.workspace.repository.WorkspaceRepository;
import java.util.List;
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
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Issuing an invite authorizes before taking the workspace lock. A demotion committed
 * while the batch waits for that lock must stop it; a mocked membership cannot show it.
 */
@SpringBootTest
class WorkspaceInviteConcurrencyTest {

    @Autowired
    private WorkspaceInviteService inviteService;

    @Autowired
    private WorkspaceRepository workspaceRepository;

    @Autowired
    private WorkspaceMemberRepository memberRepository;

    @Autowired
    private WorkspaceInviteRepository inviteRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @MockitoSpyBean
    private WorkspaceAccessService accessService;

    @MockitoBean
    private WorkspaceInviteNotifier notifier;

    private Workspace workspace;
    private User actor;

    @BeforeEach
    void seedWorkspace() {
        actor = userRepository.saveAndFlush(User.builder()
                .email("invite-race-admin@example.com")
                .displayName("Admin")
                .build());
        workspace = workspaceRepository.saveAndFlush(
                Workspace.builder().name("Race").build());
        memberRepository.saveAndFlush(WorkspaceMember.builder()
                .workspace(workspace)
                .user(actor)
                .role(WorkspaceRole.ADMIN)
                .build());
        when(notifier.isDeliveryConfigured()).thenReturn(true);
    }

    @AfterEach
    void removeCreatedRows() {
        inviteRepository.deleteAll();
        memberRepository.deleteAll();
        workspaceRepository.deleteAll();
        userRepository.deleteAll();
    }

    @Test
    void demotedAdminCannotIssueInvitesAfterWaitingForTheLock() throws Exception {
        CountDownLatch actorLoaded = new CountDownLatch(1);
        doAnswer(invocation -> {
                    Object result = invocation.callRealMethod();
                    actorLoaded.countDown();
                    return result;
                })
                .when(accessService)
                .requireAdmin(actor.getId());

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
                        inviteService.createInvites(
                                actor.getId(), new WorkspaceInviteCreateRequest(List.of("jane@example.com"), "MEMBER"));
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

            assertThat(outcome.get().get(30, TimeUnit.SECONDS)).isEqualTo(ErrorCode.FORBIDDEN);
        } finally {
            pool.shutdownNow();
        }

        assertThat(inviteRepository.findAll()).isEmpty();
        verify(notifier, never()).inviteIssued(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }
}
