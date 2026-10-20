package com.nextdocs.api.workspace.entity;

import com.nextdocs.api.auth.entity.User;
import jakarta.persistence.*;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

/**
 * A single-use authorization record for one email.
 *
 * <p>The invitation link carries a random token; the row stores only its SHA-256 hash,
 * so accepting the link is what proves the registrant controls the invited mailbox (no
 * separate verification email) and a database leak yields no usable links. The raw
 * token exists only in the delivery email — never in an API response, where the admin
 * could copy it and undo the mailbox proof — and the link carries it in the URL
 * fragment, which the server never sees.
 *
 * <p>Single-use is the {@code accepted_at} claim, written with a conditional UPDATE
 * that also checks the exact {@code token_hash}: two concurrent registrations cannot
 * both consume the invite, and a token rotated by a resend cannot be redeemed by a
 * stale link. A revoked or replaced invite is deleted: there is no {@code revoked_at}
 * state.
 */
@Entity
@Table(name = "workspace_invites")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class WorkspaceInvite {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "workspace_id", nullable = false)
    private Workspace workspace;

    /** Normalized (lowercased) at issue time so it compares equal to a registration email. */
    @Column(nullable = false, length = 255)
    private String email;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private WorkspaceRole role;

    /** SHA-256 hex of the single-use signup token; the raw token is never stored. */
    @Column(name = "token_hash", nullable = false, unique = true, length = 255)
    private String tokenHash;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "created_by", nullable = false)
    private User createdBy;

    @Column(name = "expires_at", nullable = false)
    private OffsetDateTime expiresAt;

    @Column(name = "accepted_at")
    private OffsetDateTime acceptedAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "accepted_by")
    private User acceptedBy;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    /** Not yet accepted; an expired invite is still pending until it is revoked or re-issued. */
    public boolean isPending() {
        return acceptedAt == null;
    }

    /** Pending and not past its expiry: the only state a registration may consume. */
    public boolean isUsable() {
        return isPending() && expiresAt.isAfter(OffsetDateTime.now());
    }
}
