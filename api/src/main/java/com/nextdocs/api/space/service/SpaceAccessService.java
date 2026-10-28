package com.nextdocs.api.space.service;

import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.space.entity.Space;
import com.nextdocs.api.space.entity.SpaceAccessMode;
import com.nextdocs.api.space.entity.SpaceMember;
import com.nextdocs.api.space.repository.SpaceMemberRepository;
import com.nextdocs.api.space.repository.SpaceRepository;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import com.nextdocs.api.workspace.service.WorkspaceAccessService;
import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityNotFoundException;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Resolves the caller's standing in a space and enforces the gates.
 *
 * <p>Levels are read from the database on every request — never from a token — so a
 * demotion or removal applies to the very next call. A space the caller cannot see is
 * masked as 404, mirroring {@link WorkspaceAccessService}, so a non-member cannot
 * distinguish "no space" from "not allowed".
 *
 * <p>Two axes stay deliberately separate:
 *
 * <ul>
 *   <li><b>Content</b> — {@code accessLevel}, which is what a page inside the space
 *       resolves. A workspace admin who is not a space member has no content access:
 *       seeing pages is not an administrative act.
 *   <li><b>Administration</b> — a space {@code OWNER}, plus any workspace owner or
 *       admin. The workspace escape hatch is what keeps a space administrable after
 *       its last owner leaves the instance, since the last-owner rule forbids removing
 *       that owner but cannot forbid off-boarding them from the workspace.
 * </ul>
 */
@Service
@RequiredArgsConstructor
public class SpaceAccessService {

    private final SpaceRepository spaceRepository;
    private final SpaceMemberRepository memberRepository;
    private final WorkspaceAccessService workspaceAccessService;
    private final EntityManager entityManager;

    /** A resolved space plus the caller's content level (null when none) and workspace role. */
    public record SpaceContext(Space space, WorkspaceRole workspaceRole, DocumentAccessLevel accessLevel) {

        /** Workspace owner or admin: may administer every space of the workspace. */
        public boolean workspaceAdmin() {
            return workspaceRole.canManageMembers();
        }

        /** May rename, re-share, delete, and manage members. */
        public boolean canAdminister() {
            return workspaceAdmin() || accessLevel == DocumentAccessLevel.OWNER;
        }
    }

    /**
     * Re-reads a managed space after the caller has locked its row. The gate may have
     * loaded the entity before waiting on the lock, and a lock query does not overwrite
     * an already-managed entity, so a committed archive would otherwise stay invisible
     * to the post-lock re-check.
     */
    @Transactional
    public void refreshForLock(Space space) {
        try {
            entityManager.refresh(space);
        } catch (EntityNotFoundException ex) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
    }

    /**
     * Loads the space and the caller's level, or 404 for a space of another workspace.
     * Never gates: callers choose the gate, so one load serves read and admin paths.
     */
    @Transactional(readOnly = true)
    public SpaceContext load(UUID userId, UUID spaceId) {
        WorkspaceAccessService.Membership membership = workspaceAccessService.requireMember(userId);
        Space space = spaceRepository
                .findByIdAndWorkspace_Id(spaceId, membership.workspace().getId())
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
        return new SpaceContext(space, membership.member().getRole(), resolveLevel(userId, space));
    }

    /**
     * Content read. A Public space answers with its everyone-else level for any member
     * of the workspace; a Custom space only for listed members. Workspace admins pass
     * so they can administer a space they are not part of.
     */
    @Transactional(readOnly = true)
    public SpaceContext requireRead(UUID userId, UUID spaceId) {
        SpaceContext context = load(userId, spaceId);
        if (context.accessLevel() == null && !context.workspaceAdmin()) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
        return context;
    }

    /**
     * Content read that never falls back to workspace administration. Page listings and
     * page content go through this gate: an admin who is not a member may manage a space
     * but must not read the titles and bodies inside it.
     */
    @Transactional(readOnly = true)
    public SpaceContext requireContentRead(UUID userId, UUID spaceId) {
        SpaceContext context = load(userId, spaceId);
        if (context.accessLevel() == null) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
        return context;
    }

    /**
     * Roster access: a listed member, or a workspace admin. A Public space grants content
     * read to every workspace member, but who is in the space is not content: a reader who
     * is not a member gets 403 rather than a list of names. The space itself is visible to
     * them, so masking this as 404 would lie about the space's existence.
     */
    @Transactional(readOnly = true)
    public SpaceContext requireRoster(UUID userId, UUID spaceId) {
        SpaceContext context = requireRead(userId, spaceId);
        if (context.workspaceAdmin() || memberRepository.existsBySpace_IdAndUser_Id(spaceId, userId)) {
            return context;
        }
        throw new ApiException(ErrorCode.FORBIDDEN);
    }

    /** Content write. Workspace admins are not exempt: adding content is not administration. */
    @Transactional(readOnly = true)
    public SpaceContext requireEdit(UUID userId, UUID spaceId) {
        SpaceContext context = load(userId, spaceId);
        if (context.accessLevel() == null) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
        if (!context.accessLevel().allowsEdit()) {
            throw new ApiException(ErrorCode.FORBIDDEN);
        }
        if (context.space().getArchivedAt() != null) {
            throw new ApiException(ErrorCode.CONFLICT, "This space is archived. Restore it before editing.");
        }
        return context;
    }

    /**
     * Space ownership: the space {@code OWNER} level, or a workspace owner/admin.
     * A caller with no standing at all gets 404 rather than 403 so a Custom space's
     * existence is not confirmed to strangers.
     */
    @Transactional(readOnly = true)
    public SpaceContext requireAdministration(UUID userId, UUID spaceId) {
        SpaceContext context = load(userId, spaceId);
        if (context.canAdminister()) {
            return context;
        }
        throw new ApiException(context.accessLevel() == null ? ErrorCode.NOT_FOUND : ErrorCode.FORBIDDEN);
    }

    /**
     * Administration of an active space. Archive/restore/delete deliberately use
     * {@link #requireAdministration} instead: an archived space still has to be
     * restorable and, when empty, deletable.
     */
    @Transactional(readOnly = true)
    public SpaceContext requireActiveAdministration(UUID userId, UUID spaceId) {
        SpaceContext context = requireAdministration(userId, spaceId);
        if (context.space().getArchivedAt() != null) {
            throw new ApiException(ErrorCode.CONFLICT, "This space is archived. Restore it before making changes.");
        }
        return context;
    }

    /** The caller's content level for a loaded space, or null when none. */
    @Transactional(readOnly = true)
    public DocumentAccessLevel resolveLevel(UUID userId, Space space) {
        return memberRepository
                .findBySpace_IdAndUser_Id(space.getId(), userId)
                .map(SpaceMember::getAccessLevel)
                .orElseGet(
                        () -> space.getAccessMode() == SpaceAccessMode.PUBLIC ? space.getEveryoneAccessLevel() : null);
    }
}
