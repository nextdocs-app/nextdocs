package com.nextdocs.api.auth.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.nextdocs.api.auth.dto.request.RegisterRequest;
import com.nextdocs.api.auth.dto.response.AuthResponse;
import com.nextdocs.api.auth.repository.RefreshTokenRepository;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.workspace.entity.InstanceLock;
import com.nextdocs.api.workspace.entity.WorkspaceMember;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import com.nextdocs.api.workspace.repository.InstanceLockRepository;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import com.nextdocs.api.workspace.repository.WorkspaceRepository;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.annotation.DirtiesContext;

/**
 * The bootstrap race cannot be pinned with mocks: two transactions have to contend for
 * the V22 lock row on a real database (H2 here, Postgres in CI). Without the lock both
 * callers would see an empty instance and each would create a workspace and an owner.
 *
 * <p>Marked dirty before the class so the shared test schema is recreated and the race
 * starts on a genuinely empty instance no matter which test class ran before.
 */
@SpringBootTest
@DirtiesContext(classMode = DirtiesContext.ClassMode.BEFORE_CLASS)
class BootstrapRegistrationConcurrencyTest {

    /** V22 seeds this row with Flyway; the test schema is built from the entities. */
    private static final short INSTANCE_LOCK_ID = 1;

    @Autowired
    private AuthService authService;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private RefreshTokenRepository refreshTokenRepository;

    @Autowired
    private WorkspaceRepository workspaceRepository;

    @Autowired
    private WorkspaceMemberRepository memberRepository;

    @Autowired
    private InstanceLockRepository instanceLockRepository;

    @BeforeEach
    void seedInstanceLockRow() {
        if (instanceLockRepository.findById(INSTANCE_LOCK_ID).isEmpty()) {
            InstanceLock lock = new InstanceLock();
            lock.setId(INSTANCE_LOCK_ID);
            instanceLockRepository.saveAndFlush(lock);
        }
    }

    /**
     * This class never runs inside a test transaction (the two racers need their own),
     * so remove the rows it created before handing the context back.
     */
    @AfterEach
    void removeCreatedRows() {
        refreshTokenRepository.deleteAll();
        memberRepository.deleteAll();
        workspaceRepository.deleteAll();
        userRepository.deleteAll();
    }

    @Test
    void concurrentFirstRegistrations_bootstrapExactlyOnce() throws Exception {
        assertThat(memberRepository.count())
                .as("the bootstrap race needs an empty instance")
                .isZero();

        String firstEmail = "bootstrap-first@example.com";
        String secondEmail = "bootstrap-second@example.com";
        CyclicBarrier start = new CyclicBarrier(2);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<Object> first = pool.submit(() -> registerOrRefusal(firstEmail, start));
            Future<Object> second = pool.submit(() -> registerOrRefusal(secondEmail, start));

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
            assertThat(refusals.get(0).getErrorCode()).isEqualTo(ErrorCode.REGISTRATION_INVITE_REQUIRED);

            UUID winnerId = winners.get(0).user().id();
            String winnerEmail = winners.get(0).user().email();
            String loserEmail = winnerEmail.equals(firstEmail) ? secondEmail : firstEmail;

            // Exactly one workspace, owned by exactly the winner. The loser answered like
            // any registration without an invite and rolled back clean, so it left no
            // account or membership behind.
            assertThat(workspaceRepository.count()).isEqualTo(1);
            assertThat(memberRepository.count()).isEqualTo(1);
            WorkspaceMember membership = memberRepository.findByUserId(winnerId).orElseThrow();
            assertThat(membership.getRole()).isEqualTo(WorkspaceRole.OWNER);
            assertThat(userRepository.findByEmail(loserEmail)).isEmpty();
            assertThat(userRepository.findByEmail(winnerEmail))
                    .hasValueSatisfying(
                            user -> assertThat(user.isEmailVerified()).isFalse());
        } finally {
            pool.shutdownNow();
        }
    }

    /**
     * The same address on both sides: the account insert must happen only after the
     * instance lock, or the loser's insert hits {@code uq_users_email} before it can
     * see that the winner bootstrapped.
     */
    @Test
    void concurrentFirstRegistrationsWithTheSameEmail_answerARefusalNotAConstraintFailure() throws Exception {
        assertThat(memberRepository.count())
                .as("the bootstrap race needs an empty instance")
                .isZero();

        String email = "bootstrap-same@example.com";
        CyclicBarrier start = new CyclicBarrier(2);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<Object> first = pool.submit(() -> registerOrRefusal(email, start));
            Future<Object> second = pool.submit(() -> registerOrRefusal(email, start));

            List<Object> outcomes = List.of(first.get(30, TimeUnit.SECONDS), second.get(30, TimeUnit.SECONDS));

            assertThat(outcomes.stream().filter(AuthResponse.class::isInstance)).hasSize(1);
            assertThat(outcomes.stream().filter(ApiException.class::isInstance)).hasSize(1);
            ApiException refusal = outcomes.stream()
                    .filter(ApiException.class::isInstance)
                    .map(ApiException.class::cast)
                    .findFirst()
                    .orElseThrow();
            assertThat(refusal.getErrorCode()).isEqualTo(ErrorCode.REGISTRATION_INVITE_REQUIRED);
            assertThat(userRepository.findByEmail(email)).isPresent();
            assertThat(workspaceRepository.count()).isEqualTo(1);
            assertThat(memberRepository.count()).isEqualTo(1);
        } finally {
            pool.shutdownNow();
        }
    }

    /**
     * Both racers arrive with no invite token: on a fresh instance one of them
     * bootstraps, and whatever the interleaving, the other is exactly the request the
     * gate refuses.
     */
    private Object registerOrRefusal(String email, CyclicBarrier start) throws Exception {
        start.await(10, TimeUnit.SECONDS);
        try {
            return authService.register(
                    new RegisterRequest(email, "First Racer", "password123", null),
                    new MockHttpServletRequest(),
                    new MockHttpServletResponse());
        } catch (ApiException ex) {
            return ex;
        }
    }
}
