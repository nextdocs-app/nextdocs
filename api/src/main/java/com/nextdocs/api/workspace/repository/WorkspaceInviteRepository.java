package com.nextdocs.api.workspace.repository;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.workspace.entity.WorkspaceInvite;
import jakarta.persistence.LockModeType;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

@Repository
public interface WorkspaceInviteRepository extends JpaRepository<WorkspaceInvite, UUID> {

    /**
     * The invite carrying {@code tokenHash}, at most one row (the column is unique, and
     * the instance has a single workspace, so no workspace filter is needed on this
     * path). Pending-ness, expiry and the bound email are the service's checks.
     */
    Optional<WorkspaceInvite> findByTokenHash(String tokenHash);

    /**
     * The same row as {@link #findByTokenHash}, write-locked for redemption. Concurrent
     * registrations of one token serialize here: the loser waits for the claim to
     * commit, then sees the accepted (or rotated) row instead of racing the user insert
     * into {@code uq_users_email}.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT i FROM WorkspaceInvite i WHERE i.tokenHash = :tokenHash")
    Optional<WorkspaceInvite> findByTokenHashForUpdate(@Param("tokenHash") String tokenHash);

    Optional<WorkspaceInvite> findByIdAndWorkspaceId(UUID id, UUID workspaceId);

    Optional<WorkspaceInvite> findByWorkspaceIdAndEmailAndAcceptedAtIsNull(UUID workspaceId, String email);

    /** Pending invites (accepted or not is the only state): what the People view lists. */
    Page<WorkspaceInvite> findAllByWorkspaceIdAndAcceptedAtIsNull(UUID workspaceId, Pageable pageable);

    /** Deletes expired, unaccepted invites left past the retention window. */
    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM WorkspaceInvite i WHERE i.acceptedAt IS NULL AND i.expiresAt < :cutoff")
    int deletePendingExpiredBefore(@Param("cutoff") OffsetDateTime cutoff);

    /** Deletes a still-pending invite and returns 1, or 0 when it was claimed in the meantime. */
    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM WorkspaceInvite i WHERE i.id = :id AND i.acceptedAt IS NULL")
    int deletePendingById(@Param("id") UUID id);

    /**
     * Deletes the pending invite for one email ahead of re-issuing it. A derived delete
     * would select-then-delete by id, which can remove a row claimed in between. The
     * delete must land before the replacement insert: the partial unique index only
     * tolerates one pending row per address.
     */
    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM WorkspaceInvite i WHERE i.workspace.id = :workspaceId AND i.email = :email "
            + "AND i.acceptedAt IS NULL")
    int deletePendingByEmail(@Param("workspaceId") UUID workspaceId, @Param("email") String email);

    /**
     * Rotates a still-pending invite onto a fresh token and expiry: the previous link
     * dies with the old hash. Returns 0 when the invite was claimed in the meantime,
     * which the caller masks as absent like the rest of invite management.
     */
    @Modifying(flushAutomatically = true)
    @Query("UPDATE WorkspaceInvite i SET i.tokenHash = :tokenHash, i.expiresAt = :expiresAt "
            + "WHERE i.id = :id AND i.acceptedAt IS NULL")
    int rotatePendingToken(
            @Param("id") UUID id, @Param("tokenHash") String tokenHash, @Param("expiresAt") OffsetDateTime expiresAt);

    /**
     * Claims the invite for {@code user}: a conditional UPDATE on the exact token hash,
     * so of N concurrent registrations only the one presenting the current token gets
     * {@code 1}; a claim that lost the race, or a token rotated by a resend since the
     * lookup, sees {@code 0} and the caller rolls back and answers INVALID_INVITE.
     *
     * <p>{@code flushAutomatically} is load-bearing: the freshly saved/reactivated user
     * must hit the database before this statement, or {@code accepted_by} breaks its
     * foreign key. The persistence context is deliberately not cleared — the caller
     * keeps using the invite's role and workspace within its transaction.
     */
    @Modifying(flushAutomatically = true)
    @Query("UPDATE WorkspaceInvite i SET i.acceptedAt = :now, i.acceptedBy = :user "
            + "WHERE i.id = :id AND i.tokenHash = :tokenHash AND i.acceptedAt IS NULL AND i.expiresAt > :now")
    int markAccepted(
            @Param("id") UUID id,
            @Param("tokenHash") String tokenHash,
            @Param("user") User user,
            @Param("now") OffsetDateTime now);
}
