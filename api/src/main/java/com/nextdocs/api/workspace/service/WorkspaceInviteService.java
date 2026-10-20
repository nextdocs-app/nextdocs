package com.nextdocs.api.workspace.service;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.common.util.EmailNormalizer;
import com.nextdocs.api.common.util.SecureTokens;
import com.nextdocs.api.pageicon.validation.PageIconValidator;
import com.nextdocs.api.workspace.dto.request.WorkspaceInviteCreateRequest;
import com.nextdocs.api.workspace.dto.response.WorkspaceInviteCreatedResponse;
import com.nextdocs.api.workspace.dto.response.WorkspaceInviteEmailResult;
import com.nextdocs.api.workspace.dto.response.WorkspaceInvitePreviewResponse;
import com.nextdocs.api.workspace.dto.response.WorkspaceInviteResponse;
import com.nextdocs.api.workspace.entity.WorkspaceInvite;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import com.nextdocs.api.workspace.repository.WorkspaceInviteRepository;
import com.nextdocs.api.workspace.repository.WorkspaceRepository;
import com.nextdocs.api.workspace.service.WorkspaceAccessService.Membership;
import jakarta.validation.Validator;
import jakarta.validation.constraints.Email;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Invite lifecycle: issuing, listing, previewing, revoking, resending and consuming.
 *
 * <p>An invite is an email-bound, single-use authorization for one address: the signup
 * link travels only to the invited mailbox, so accepting it proves the registrant reads
 * that mailbox and registration needs no second verification email. The API never
 * returns the link — an admin who could copy it would turn mailbox proof back into
 * possession of a URL — so without a mail relay the service refuses to issue invites at
 * all. Only the token's SHA-256 hash is stored, and the claim is a conditional UPDATE on
 * the exact hash, so a rotated or already-consumed invite cannot be redeemed by a stale
 * link.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class WorkspaceInviteService {

    /**
     * Registration judges the address with {@code @Email}, so the invite side reuses the
     * exact constraint: a looser check would mint invites for addresses the registration
     * endpoint then refuses, leaving a link that can only be emailed and never accepted.
     */
    private record EmailProbe(@Email String email) {}

    /** Where the join page reads the token from: the fragment never reaches the server. */
    private static final String JOIN_PATH = "/join#token=";

    /** Upper bound on one People-view page, regardless of what the caller asks for. */
    private static final int MAX_INVITE_PAGE_SIZE = 100;

    private final WorkspaceInviteRepository inviteRepository;
    private final WorkspaceAccessService accessService;
    private final UserRepository userRepository;
    private final WorkspaceRepository workspaceRepository;
    private final WorkspaceInviteNotifier notifier;
    private final Validator validator;

    @Value("${app.workspace.invite-expiry-days}")
    private long inviteExpiryDays;

    /** How long an expired, unaccepted invite stays visible before the sweep deletes it. */
    @Value("${app.workspace.expired-invite-retention-days:30}")
    private long expiredInviteRetentionDays = 30;

    @Value("${app.web.base-url}")
    private String webBaseUrl;

    /**
     * Issues one invite per distinct email. A malformed or already-registered address
     * gets its own result instead of failing the batch; the caller's role decides which
     * invite role may be issued at all.
     */
    @Transactional
    public List<WorkspaceInviteEmailResult> createInvites(UUID actorId, WorkspaceInviteCreateRequest request) {
        Membership actor = accessService.requireAdmin(actorId);
        WorkspaceRole role = parseRole(request.role());
        if (!actor.member().getRole().canGrant(role)) {
            throw new ApiException(ErrorCode.FORBIDDEN);
        }
        requireDeliveryConfigured();
        // Row-locks the workspace so concurrent batches serialize: two admins inviting
        // the same email would otherwise both see no pending invite, and the loser of
        // that race would fail the partial unique index instead of replacing the row.
        // Same lock order as the role mutations (workspace, then its rows).
        lockWorkspace(actor.workspace().getId());
        // The admin and grant checks above ran before the lock; re-read the actor so a
        // demotion committed while this transaction waited cannot issue an invite.
        accessService.refreshForLock(actor.member());
        if (!actor.member().getRole().canManageMembers()
                || !actor.member().getRole().canGrant(role)) {
            throw new ApiException(ErrorCode.FORBIDDEN);
        }

        List<WorkspaceInviteEmailResult> results = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        for (String rawEmail : request.emails()) {
            String email = normalizeEmail(rawEmail);
            // The batch parser can repeat an address (folded paste, separators); blank
            // entries are the UI's business, not an invite.
            if (email.isEmpty() || !seen.add(email)) {
                continue;
            }
            if (!looksLikeEmail(email)) {
                results.add(WorkspaceInviteEmailResult.invalidEmail(email));
                continue;
            }
            // An active account cannot register again (the auth flow answers 409), so
            // inviting it would mint a dead invite; role changes have their own endpoint.
            Optional<User> existing = userRepository.findByEmail(email);
            if (existing.isPresent() && existing.get().isActive()) {
                results.add(WorkspaceInviteEmailResult.alreadyMember(email));
                continue;
            }
            results.add(WorkspaceInviteEmailResult.invited(email, issue(actor, email, role)));
        }
        return results;
    }

    @Transactional(readOnly = true)
    public Page<WorkspaceInviteResponse> listInvites(UUID actorId, Pageable pageable) {
        UUID workspaceId = accessService.requireAdmin(actorId).workspace().getId();
        Pageable bounded = PageRequest.of(
                pageable.getPageNumber(), Math.min(pageable.getPageSize(), MAX_INVITE_PAGE_SIZE), pageable.getSort());
        return inviteRepository
                .findAllByWorkspaceIdAndAcceptedAtIsNull(workspaceId, bounded)
                .map(WorkspaceInviteService::toResponse);
    }

    /**
     * Deletes expired, unaccepted invites that stayed past their retention window. They
     * can never register, and without a sweep every abandoned address would keep a row
     * forever; accepted rows are the membership audit trail and are left untouched.
     *
     * @return number of invites deleted
     */
    @Transactional
    public int purgeExpiredInvites() {
        OffsetDateTime cutoff = OffsetDateTime.now().minusDays(expiredInviteRetentionDays);
        return inviteRepository.deletePendingExpiredBefore(cutoff);
    }

    /** Permanently removes a pending invite; its link can no longer register. */
    @Transactional
    public void revoke(UUID actorId, UUID inviteId) {
        Membership actor = accessService.requireAdmin(actorId);
        WorkspaceInvite invite = requireManageable(actor, inviteId);
        // Conditional DELETE: a plain delete would remove a row claimed since the
        // lookup, erasing the audit trail of a member who just joined.
        if (inviteRepository.deletePendingById(invite.getId()) == 0) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
    }

    /**
     * Replaces the token of a pending invite in place and resets its expiry: the previous
     * link dies with the rotation, and the fresh one goes out by email again. An invite
     * claimed since the page loaded masks as absent, like the rest of invite management.
     */
    @Transactional
    public WorkspaceInviteCreatedResponse resend(UUID actorId, UUID inviteId) {
        Membership actor = accessService.requireAdmin(actorId);
        WorkspaceInvite invite = requireManageable(actor, inviteId);
        requireDeliveryConfigured();
        String rawToken = SecureTokens.mint();
        String tokenHash = SecureTokens.sha256Hex(rawToken);
        OffsetDateTime expiresAt = OffsetDateTime.now().plusDays(inviteExpiryDays);
        if (inviteRepository.rotatePendingToken(invite.getId(), tokenHash, expiresAt) == 0) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
        String invitationUrl = buildInvitationUrl(rawToken);
        notifyIssued(invite, invitationUrl);
        return new WorkspaceInviteCreatedResponse(invite.getId(), invite.getEmail(), invite.getRole(), expiresAt);
    }

    /**
     * What the join page shows before it collects a name and password: the address the
     * link admits, the workspace, the granted role and the link's expiry. Unknown,
     * expired and consumed links fail identically; the caller is unauthenticated.
     */
    @Transactional(readOnly = true)
    public WorkspaceInvitePreviewResponse preview(String rawToken) {
        WorkspaceInvite invite = requireUsableByToken(rawToken);
        return new WorkspaceInvitePreviewResponse(
                invite.getEmail(), invite.getWorkspace().getName(), invite.getRole(), invite.getExpiresAt());
    }

    /**
     * Resolves the invite a registration may use: the pending, unexpired invite carrying
     * the presented token, bound to the exact address. Unknown, expired, consumed,
     * rotated and mismatched all fail the same way, so the response cannot be used to
     * probe who has been invited.
     *
     * <p>Write-locks the invite row, so concurrent redemptions of one token serialize
     * before either creates an account. Consumption is separate ({@link #consume}) so
     * the caller can create or reactivate the account after the lock; both calls share
     * the registration transaction.
     */
    @Transactional
    public WorkspaceInvite requireUsable(String rawToken, String email) {
        WorkspaceInvite invite = inviteRepository
                .findByTokenHashForUpdate(SecureTokens.sha256Hex(rawToken))
                .filter(WorkspaceInvite::isUsable)
                .orElseThrow(() -> new ApiException(ErrorCode.INVALID_INVITE));
        if (!invite.getEmail().equals(normalizeEmail(email))) {
            throw new ApiException(ErrorCode.INVALID_INVITE);
        }
        return invite;
    }

    /**
     * Claims the invite for {@code user} against the token it was validated with. The
     * conditional UPDATE re-checks the exact hash and pending state, so losing a
     * registration race, an invite expiring since validation, or a resend that rotated
     * the token all fail as an invalid invite; the caller's transaction rolls back, so
     * nothing is half-created.
     */
    @Transactional
    public void consume(WorkspaceInvite invite, User user, String rawToken) {
        int claimed = inviteRepository.markAccepted(
                invite.getId(), SecureTokens.sha256Hex(rawToken), user, OffsetDateTime.now());
        if (claimed == 0) {
            throw new ApiException(ErrorCode.INVALID_INVITE);
        }
    }

    /**
     * Creates a fresh invite for {@code email}, replacing any pending one: the address
     * keeps its ability to register with a new single-use link, while the role and expiry
     * come from this batch.
     */
    private WorkspaceInviteCreatedResponse issue(Membership actor, String email, WorkspaceRole role) {
        // Replacing is revoking too: an admin who could delete a pending role it cannot
        // grant would let a member-level invite cancel the owner's OWNER invite.
        Optional<WorkspaceInvite> pending = inviteRepository.findByWorkspaceIdAndEmailAndAcceptedAtIsNull(
                actor.workspace().getId(), email);
        if (pending.isPresent()
                && !actor.member().getRole().canGrant(pending.get().getRole())) {
            throw new ApiException(ErrorCode.FORBIDDEN);
        }
        inviteRepository.deletePendingByEmail(actor.workspace().getId(), email);
        String rawToken = SecureTokens.mint();
        WorkspaceInvite invite = WorkspaceInvite.builder()
                .workspace(actor.workspace())
                .email(email)
                .role(role)
                .tokenHash(SecureTokens.sha256Hex(rawToken))
                .createdBy(actor.member().getUser())
                .expiresAt(OffsetDateTime.now().plusDays(inviteExpiryDays))
                .build();
        inviteRepository.save(invite);
        String invitationUrl = buildInvitationUrl(rawToken);
        notifyIssued(invite, invitationUrl);
        return toCreatedResponse(invite);
    }

    /**
     * Refuses to mint an invite nobody can deliver: the link is the only way to register
     * and must stay in the invited mailbox to prove it, so a copyable fallback for the
     * admin is exactly what this design forbids.
     */
    private void requireDeliveryConfigured() {
        if (!notifier.isDeliveryConfigured()) {
            throw new ApiException(ErrorCode.EMAIL_DELIVERY_NOT_CONFIGURED);
        }
    }

    /**
     * Resolves a pending invite of the caller's workspace; accepted invites are masked
     * as absent (matching the pending-only list they are managed from), and an admin
     * may not manage invites for roles it cannot grant.
     */
    private WorkspaceInvite requireManageable(Membership actor, UUID inviteId) {
        WorkspaceInvite invite = inviteRepository
                .findByIdAndWorkspaceId(inviteId, actor.workspace().getId())
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
        if (!invite.isPending()) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
        if (!actor.member().getRole().canGrant(invite.getRole())) {
            throw new ApiException(ErrorCode.FORBIDDEN);
        }
        return invite;
    }

    private WorkspaceInvite requireUsableByToken(String rawToken) {
        return inviteRepository
                .findByTokenHash(SecureTokens.sha256Hex(rawToken))
                .filter(WorkspaceInvite::isUsable)
                .orElseThrow(() -> new ApiException(ErrorCode.INVALID_INVITE));
    }

    /**
     * Tells the notifier about the invite once the transaction commits: a notice for an
     * invite a rollback undid must never be delivered. The URL carries the single-use
     * token, so it is passed in memory only and never logged.
     */
    private void notifyIssued(WorkspaceInvite invite, String invitationUrl) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            notifier.inviteIssued(invite, invitationUrl);
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                notifier.inviteIssued(invite, invitationUrl);
            }
        });
    }

    /** {@code {app.web.base-url}/join#token=...}; the fragment never reaches a server. */
    private String buildInvitationUrl(String rawToken) {
        String baseUrl = webBaseUrl.endsWith("/") ? webBaseUrl.substring(0, webBaseUrl.length() - 1) : webBaseUrl;
        return baseUrl + JOIN_PATH + rawToken;
    }

    private void lockWorkspace(UUID workspaceId) {
        workspaceRepository.findByIdForUpdate(workspaceId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
    }

    /** Same canonical form the auth flow applies, so invite and registration compare equal. */
    private static String normalizeEmail(String rawEmail) {
        return EmailNormalizer.normalize(rawEmail);
    }

    private boolean looksLikeEmail(String email) {
        return email.length() <= 255
                && validator.validate(new EmailProbe(email)).isEmpty();
    }

    private static WorkspaceRole parseRole(String raw) {
        try {
            return WorkspaceRole.parse(raw);
        } catch (IllegalArgumentException ex) {
            throw new ApiException(
                    ErrorCode.VALIDATION_FAILED, "Unknown workspace role: " + PageIconValidator.echo(raw) + ".");
        }
    }

    private static WorkspaceInviteCreatedResponse toCreatedResponse(WorkspaceInvite invite) {
        return new WorkspaceInviteCreatedResponse(
                invite.getId(), invite.getEmail(), invite.getRole(), invite.getExpiresAt());
    }

    private static WorkspaceInviteResponse toResponse(WorkspaceInvite invite) {
        return new WorkspaceInviteResponse(
                invite.getId(), invite.getEmail(), invite.getRole(), invite.getExpiresAt(), invite.getCreatedAt());
    }
}
