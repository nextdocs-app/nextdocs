package com.nextdocs.api.auth.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.when;

import com.nextdocs.api.auth.dto.request.RegisterRequest;
import com.nextdocs.api.auth.dto.response.AuthResponse;
import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.RefreshTokenRepository;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.common.util.SecureTokens;
import com.nextdocs.api.workspace.dto.request.WorkspaceInviteCreateRequest;
import com.nextdocs.api.workspace.dto.response.WorkspaceInviteEmailResult;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.entity.WorkspaceInvite;
import com.nextdocs.api.workspace.entity.WorkspaceMember;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import com.nextdocs.api.workspace.repository.WorkspaceInviteRepository;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import com.nextdocs.api.workspace.repository.WorkspaceRepository;
import com.nextdocs.api.workspace.service.WorkspaceInviteNotifier;
import com.nextdocs.api.workspace.service.WorkspaceInviteService;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
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
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Accepting a link end to end on a real database. AuthServiceTest mocks the invite
 * service and WorkspaceInviteRepositoryTest claims with pre-saved users, so only a full
 * registration pins the load-bearing combination: the brand-new user row must reach the
 * database before the conditional claim (the invite's FK points at it), the claim must
 * land in the same commit, and the link must not admit a second registration.
 */
@SpringBootTest
class InvitedRegistrationIntegrationTest {

    @Autowired
    private AuthService authService;

    @Autowired
    private WorkspaceInviteService inviteService;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private RefreshTokenRepository refreshTokenRepository;

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

    /** The signup URL exactly as the email would carry it. */
    private final AtomicReference<String> announcedUrl = new AtomicReference<>();

    private final List<UUID> createdInviteIds = new ArrayList<>();

    private UUID ownerId;
    private UUID workspaceId;
    private UUID joinedUserId;

    @BeforeEach
    void seedOwnerAndCaptureNotices() {
        User owner = userRepository.saveAndFlush(User.builder()
                .email("accept-owner@example.com")
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
        when(notifier.isDeliveryConfigured()).thenReturn(true);
        doAnswer(invocation -> {
                    announcedUrl.set(invocation.getArgument(1));
                    return null;
                })
                .when(notifier)
                .inviteIssued(any(), any());
    }

    @AfterEach
    void removeCreatedRows() {
        refreshTokenRepository.deleteAll();
        createdInviteIds.forEach(inviteRepository::deleteById);
        memberRepository.findByUserId(ownerId).ifPresent(memberRepository::delete);
        if (joinedUserId != null) {
            memberRepository.findByUserId(joinedUserId).ifPresent(memberRepository::delete);
            userRepository.deleteById(joinedUserId);
        }
        workspaceRepository.deleteById(workspaceId);
        userRepository.deleteById(ownerId);
    }

    @Test
    void acceptingAnInviteJoinsAVerifiedMemberAndConsumesTheLink() {
        WorkspaceInviteEmailResult created = inviteService
                .createInvites(ownerId, new WorkspaceInviteCreateRequest(List.of("jane@example.com"), "MEMBER"))
                .get(0);
        createdInviteIds.add(created.invite().id());
        String rawToken = tokenFromUrl(announcedUrl.get());

        AuthResponse response = authService.register(
                new RegisterRequest("jane@example.com", "Jane Doe", "password123", rawToken),
                new MockHttpServletRequest(),
                new MockHttpServletResponse());

        // The invitation was the mailbox proof, so the account starts verified.
        assertThat(response.user().emailVerified()).isTrue();
        User jane = userRepository.findByEmail("jane@example.com").orElseThrow();
        joinedUserId = jane.getId();
        assertThat(jane.isEmailVerified()).isTrue();
        assertThat(memberRepository.findByUserId(jane.getId()).orElseThrow().getRole())
                .isEqualTo(WorkspaceRole.MEMBER);

        // The claim is durable: the row keeps the hash and records the accepted user.
        WorkspaceInvite claimed = newTransaction()
                .execute(status ->
                        inviteRepository.findById(created.invite().id()).orElseThrow());
        assertThat(claimed.getAcceptedAt()).isNotNull();
        assertThat(claimed.getTokenHash()).isEqualTo(SecureTokens.sha256Hex(rawToken));
        UUID claimerId = newTransaction()
                .execute(status -> inviteRepository
                        .findById(created.invite().id())
                        .orElseThrow()
                        .getAcceptedBy()
                        .getId());
        assertThat(claimerId).isEqualTo(jane.getId());

        // Single use: the same link cannot admit a second registration.
        assertThatThrownBy(() -> authService.register(
                        new RegisterRequest("jane@example.com", "Jane Doe", "password123", rawToken),
                        new MockHttpServletRequest(),
                        new MockHttpServletResponse()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.INVALID_INVITE));
    }

    /**
     * Two registrations carrying the same link. Without the invite row lock both read
     * the pending token, then race the same-email user insert; the loser hits
     * {@code uq_users_email} before the conditional claim and the API answers 500.
     */
    @Test
    void concurrentRedemptionsOfOneInvite_admitExactlyOneAndRejectTheOther() throws Exception {
        WorkspaceInviteEmailResult created = inviteService
                .createInvites(ownerId, new WorkspaceInviteCreateRequest(List.of("jane@example.com"), "MEMBER"))
                .get(0);
        createdInviteIds.add(created.invite().id());
        String rawToken = tokenFromUrl(announcedUrl.get());

        CyclicBarrier start = new CyclicBarrier(2);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<Object> first = pool.submit(() -> registerOrRefusal("jane@example.com", rawToken, start));
            Future<Object> second = pool.submit(() -> registerOrRefusal("jane@example.com", rawToken, start));

            List<Object> outcomes = List.of(first.get(30, TimeUnit.SECONDS), second.get(30, TimeUnit.SECONDS));
            List<AuthResponse> winners = outcomes.stream()
                    .filter(AuthResponse.class::isInstance)
                    .map(AuthResponse.class::cast)
                    .toList();
            List<ApiException> refusals = outcomes.stream()
                    .filter(ApiException.class::isInstance)
                    .map(ApiException.class::cast)
                    .toList();

            assertThat(winners).hasSize(1);
            assertThat(refusals).hasSize(1);
            assertThat(refusals.get(0).getErrorCode()).isEqualTo(ErrorCode.INVALID_INVITE);

            joinedUserId = winners.get(0).user().id();
            assertThat(userRepository.findByEmail("jane@example.com")).isPresent();
            assertThat(memberRepository.findByUserId(joinedUserId)).isPresent();
        } finally {
            pool.shutdownNow();
        }
    }

    private Object registerOrRefusal(String email, String rawToken, CyclicBarrier start) throws Exception {
        start.await(10, TimeUnit.SECONDS);
        try {
            return authService.register(
                    new RegisterRequest(email, "Jane Doe", "password123", rawToken),
                    new MockHttpServletRequest(),
                    new MockHttpServletResponse());
        } catch (ApiException ex) {
            return ex;
        }
    }

    private static String tokenFromUrl(String invitationUrl) {
        String marker = "/join#token=";
        assertThat(invitationUrl).contains(marker);
        return invitationUrl.substring(invitationUrl.indexOf(marker) + marker.length());
    }

    private TransactionTemplate newTransaction() {
        return new TransactionTemplate(transactionManager);
    }
}
