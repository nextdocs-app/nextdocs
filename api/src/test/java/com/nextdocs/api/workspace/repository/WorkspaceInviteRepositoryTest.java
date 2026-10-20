package com.nextdocs.api.workspace.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.entity.WorkspaceInvite;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import jakarta.persistence.EntityManager;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

/**
 * Pins the conditional invite statements against the persistence layer: a claim on one
 * side and a re-claim, re-invite or resend on the other must never overwrite each other
 * the way plain full-column writes from stale entities would.
 */
@SpringBootTest
@Transactional
class WorkspaceInviteRepositoryTest {

    @Autowired
    private WorkspaceInviteRepository inviteRepository;

    @Autowired
    private WorkspaceRepository workspaceRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private EntityManager entityManager;

    private Workspace workspace;
    private User owner;
    private User invitee;

    @BeforeEach
    void setUp() {
        owner = userRepository.saveAndFlush(
                User.builder().email("owner@example.com").displayName("Owner").build());
        invitee = userRepository.saveAndFlush(
                User.builder().email("jane@example.com").displayName("Jane").build());
        workspace = workspaceRepository.saveAndFlush(
                Workspace.builder().name("NextDocs").build());
    }

    @Test
    void markAccepted_claimsAPendingInviteExactlyOnce() {
        WorkspaceInvite invite = pendingInvite("jane@example.com");

        assertThat(inviteRepository.markAccepted(invite.getId(), invite.getTokenHash(), invitee, OffsetDateTime.now()))
                .isEqualTo(1);
        // A second claim for the same single-use invite must lose.
        assertThat(inviteRepository.markAccepted(invite.getId(), invite.getTokenHash(), owner, OffsetDateTime.now()))
                .isZero();

        WorkspaceInvite claimed = reload(invite.getId());
        assertThat(claimed.getAcceptedAt()).isNotNull();
        assertThat(claimed.getAcceptedBy().getId()).isEqualTo(invitee.getId());
    }

    @Test
    void markAccepted_requiresTheExactTokenHash() {
        WorkspaceInvite invite = pendingInvite("jane@example.com");

        // The UPDATE checks the hash the registration validated: a claim that lost to a
        // resend's rotation (or a guessed id) must affect no row.
        assertThat(inviteRepository.markAccepted(invite.getId(), "someone-elses-hash", invitee, OffsetDateTime.now()))
                .isZero();
        assertThat(reload(invite.getId()).getAcceptedAt()).isNull();

        assertThat(inviteRepository.markAccepted(invite.getId(), invite.getTokenHash(), invitee, OffsetDateTime.now()))
                .isEqualTo(1);
    }

    @Test
    void markAccepted_forAnExpiredInvite_claimsNothing() {
        WorkspaceInvite invite = WorkspaceInvite.builder()
                .workspace(workspace)
                .email("jane@example.com")
                .role(WorkspaceRole.MEMBER)
                .tokenHash("expired-hash")
                .createdBy(owner)
                .expiresAt(OffsetDateTime.now().minusSeconds(1))
                .build();
        inviteRepository.saveAndFlush(invite);

        // The UPDATE re-checks expiry: an invite that lapsed since the registration
        // looked it up must not be claimable.
        assertThat(inviteRepository.markAccepted(invite.getId(), invite.getTokenHash(), invitee, OffsetDateTime.now()))
                .isZero();
        assertThat(reload(invite.getId()).getAcceptedAt()).isNull();
    }

    @Test
    void rotatePendingToken_movesTheInviteOntoAFreshHashAndExpiry() {
        WorkspaceInvite invite = pendingInvite("jane@example.com");
        OffsetDateTime freshExpiry = OffsetDateTime.now().plusDays(3).truncatedTo(ChronoUnit.MICROS);

        assertThat(inviteRepository.rotatePendingToken(invite.getId(), "fresh-hash", freshExpiry))
                .isEqualTo(1);

        WorkspaceInvite rotated = reload(invite.getId());
        assertThat(rotated.getTokenHash()).isEqualTo("fresh-hash");
        assertThat(rotated.getExpiresAt()).isEqualTo(freshExpiry);
        assertThat(rotated.getExpiresAt()).isBefore(invite.getExpiresAt());
        // The link that carried the old token is dead, not aliased onto the new one.
        assertThat(inviteRepository.findByTokenHash(invite.getTokenHash())).isEmpty();
        assertThat(inviteRepository.findByTokenHash("fresh-hash")).isPresent();
    }

    @Test
    void rotatePendingToken_afterAClaim_leavesTheAcceptedRowUntouched() {
        WorkspaceInvite invite = pendingInvite("jane@example.com");
        inviteRepository.markAccepted(invite.getId(), invite.getTokenHash(), invitee, OffsetDateTime.now());

        // A resend that loses to an acceptance must not revive the invite or rotate
        // anything on the audit row.
        assertThat(inviteRepository.rotatePendingToken(
                        invite.getId(), "fresh-hash", OffsetDateTime.now().plusDays(7)))
                .isZero();
        assertThat(reload(invite.getId()).getTokenHash()).isEqualTo(invite.getTokenHash());
    }

    @Test
    void findByTokenHash_resolvesOnlyTheExactHash() {
        WorkspaceInvite invite = pendingInvite("jane@example.com");

        assertThat(inviteRepository.findByTokenHash(invite.getTokenHash())).contains(invite);
        assertThat(inviteRepository.findByTokenHash("some-other-hash")).isEmpty();
    }

    @Test
    void deletePendingById_afterAClaim_keepsTheAuditRow() {
        WorkspaceInvite invite = pendingInvite("jane@example.com");
        inviteRepository.markAccepted(invite.getId(), invite.getTokenHash(), invitee, OffsetDateTime.now());

        assertThat(inviteRepository.deletePendingById(invite.getId())).isZero();
        assertThat(exists(invite.getId())).isTrue();
    }

    @Test
    void deletePendingByEmail_afterAClaim_keepsTheAuditRow() {
        WorkspaceInvite invite = pendingInvite("jane@example.com");
        inviteRepository.markAccepted(invite.getId(), invite.getTokenHash(), invitee, OffsetDateTime.now());

        assertThat(inviteRepository.deletePendingByEmail(workspace.getId(), "jane@example.com"))
                .isZero();
        assertThat(exists(invite.getId())).isTrue();
    }

    @Test
    void deletePendingByEmail_deletesOnlyThePendingRowForThatEmail() {
        WorkspaceInvite jane = pendingInvite("jane@example.com");
        WorkspaceInvite john = pendingInvite("john@example.com");

        assertThat(inviteRepository.deletePendingByEmail(workspace.getId(), "jane@example.com"))
                .isEqualTo(1);

        assertThat(exists(jane.getId())).isFalse();
        assertThat(exists(john.getId())).isTrue();
    }

    @Test
    void deletePendingExpiredBefore_deletesOnlyExpiredPendingInvites() {
        WorkspaceInvite expired = inviteRepository.saveAndFlush(WorkspaceInvite.builder()
                .workspace(workspace)
                .email("expired@example.com")
                .role(WorkspaceRole.MEMBER)
                .tokenHash("expired-" + UUID.randomUUID())
                .createdBy(owner)
                .expiresAt(OffsetDateTime.now().minusDays(31))
                .build());
        WorkspaceInvite acceptedExpired = inviteRepository.saveAndFlush(WorkspaceInvite.builder()
                .workspace(workspace)
                .email("accepted-expired@example.com")
                .role(WorkspaceRole.MEMBER)
                .tokenHash("accepted-" + UUID.randomUUID())
                .createdBy(owner)
                .expiresAt(OffsetDateTime.now().minusDays(31))
                .acceptedAt(OffsetDateTime.now().minusDays(31))
                .acceptedBy(invitee)
                .build());
        WorkspaceInvite future = pendingInvite("future@example.com");

        assertThat(inviteRepository.deletePendingExpiredBefore(
                        OffsetDateTime.now().minusDays(30)))
                .isEqualTo(1);

        assertThat(exists(expired.getId())).isFalse();
        // Accepted rows are the audit trail; only unaccepted rows are swept.
        assertThat(exists(acceptedExpired.getId())).isTrue();
        assertThat(exists(future.getId())).isTrue();
    }

    private WorkspaceInvite pendingInvite(String email) {
        return pendingInvite(email, "hash-" + UUID.randomUUID());
    }

    private WorkspaceInvite pendingInvite(String email, String tokenHash) {
        return inviteRepository.saveAndFlush(WorkspaceInvite.builder()
                .workspace(workspace)
                .email(email)
                .role(WorkspaceRole.MEMBER)
                .tokenHash(tokenHash)
                .createdBy(owner)
                .expiresAt(OffsetDateTime.now().plusDays(7))
                .build());
    }

    private WorkspaceInvite reload(UUID id) {
        entityManager.flush();
        entityManager.clear();
        return inviteRepository.findById(id).orElseThrow();
    }

    private boolean exists(UUID id) {
        entityManager.clear();
        return inviteRepository.findById(id).isPresent();
    }
}
