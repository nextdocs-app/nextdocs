package com.nextdocs.api.workspace.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.workspace.dto.request.WorkspaceInviteCreateRequest;
import com.nextdocs.api.workspace.dto.response.WorkspaceInviteEmailResult;
import com.nextdocs.api.workspace.dto.response.WorkspaceInviteStatus;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.entity.WorkspaceInvite;
import com.nextdocs.api.workspace.entity.WorkspaceMember;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import com.nextdocs.api.workspace.repository.WorkspaceInviteRepository;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import com.nextdocs.api.workspace.repository.WorkspaceRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The notifier seam promises delivery only after the transaction commits. Unit tests call
 * the service outside any transaction, where both branches of the seam behave the same,
 * so only a real transaction can pin the timing: nothing leaves before the commit, and a
 * rolled-back issue is never announced.
 */
@SpringBootTest
class WorkspaceInviteNotificationIntegrationTest {

    @Autowired
    private WorkspaceInviteService inviteService;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private WorkspaceRepository workspaceRepository;

    @Autowired
    private WorkspaceMemberRepository memberRepository;

    @Autowired
    private WorkspaceInviteRepository inviteRepository;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @MockitoBean
    private WorkspaceInviteNotifier notifier;

    /** What the notifier saw, captured exactly where a real one would read it. */
    private final AtomicReference<String> announcedWorkspaceName = new AtomicReference<>();

    private final AtomicReference<String> announcedUrl = new AtomicReference<>();

    private final List<UUID> createdInviteIds = new ArrayList<>();

    private UUID ownerId;
    private UUID workspaceId;

    @BeforeEach
    void seedOwnerAndCaptureNotices() {
        User owner = userRepository.saveAndFlush(User.builder()
                .email("notify-owner@example.com")
                .displayName("Owner")
                .build());
        Workspace workspace = workspaceRepository.saveAndFlush(
                Workspace.builder().name("NextDocs").build());
        memberRepository.saveAndFlush(WorkspaceMember.builder()
                .workspace(workspace)
                .user(owner)
                .role(WorkspaceRole.OWNER)
                .build());
        ownerId = owner.getId();
        workspaceId = workspace.getId();
        // Issuing first checks the delivery capability; only then is a token minted.
        when(notifier.isDeliveryConfigured()).thenReturn(true);
        doAnswer(invocation -> {
                    WorkspaceInvite invite = invocation.getArgument(0);
                    announcedWorkspaceName.set(invite.getWorkspace().getName());
                    announcedUrl.set(invocation.getArgument(1));
                    return null;
                })
                .when(notifier)
                .inviteIssued(any(), any());
    }

    @AfterEach
    void removeCreatedRows() {
        createdInviteIds.forEach(inviteRepository::deleteById);
        memberRepository.findByUserId(ownerId).ifPresent(memberRepository::delete);
        workspaceRepository.deleteById(workspaceId);
        userRepository.deleteById(ownerId);
    }

    @Test
    void noticeLeavesOnlyAfterTheCommit() {
        newTransaction().executeWithoutResult(status -> {
            createdInviteIds.addAll(inviteService.createInvites(ownerId, inviteRequest()).stream()
                    .map(result -> result.invite().id())
                    .toList());

            // Still inside the transaction: the notice is registered, not delivered.
            verify(notifier, never()).inviteIssued(any(), any());
            assertThat(announcedWorkspaceName.get()).isNull();
        });

        verify(notifier).inviteIssued(any(WorkspaceInvite.class), any(String.class));
        assertThat(announcedWorkspaceName.get()).isEqualTo("NextDocs");
        assertThat(announcedUrl.get()).startsWith("http://localhost:3000/join#token=");
    }

    @Test
    void rolledBackIssueIsNeverAnnounced() {
        long invitesBefore = inviteRepository.count();
        String email = "rollback-" + UUID.randomUUID() + "@example.com";

        newTransaction().executeWithoutResult(status -> {
            WorkspaceInviteEmailResult issued =
                    inviteService.createInvites(ownerId, inviteRequest(email)).get(0);
            // Prove the invite was actually staged: a fixed address that already had a
            // pending row, or a refused one, would otherwise let the rollback assertion
            // pass without exercising the afterCommit seam.
            assertThat(issued.status()).isEqualTo(WorkspaceInviteStatus.INVITED);
            assertThat(issued.invite()).isNotNull();
            status.setRollbackOnly();
        });

        verify(notifier, never()).inviteIssued(any(), any());
        assertThat(inviteRepository.count()).isEqualTo(invitesBefore);
    }

    private WorkspaceInviteCreateRequest inviteRequest() {
        return inviteRequest("jane@example.com");
    }

    private WorkspaceInviteCreateRequest inviteRequest(String email) {
        return new WorkspaceInviteCreateRequest(List.of(email), "MEMBER");
    }

    private TransactionTemplate newTransaction() {
        return new TransactionTemplate(transactionManager);
    }
}
