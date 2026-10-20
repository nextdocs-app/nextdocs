package com.nextdocs.api.workspace.service;

import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.entity.WorkspaceMember;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityNotFoundException;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Resolves the caller's workspace membership and enforces the role gates.
 *
 * <p>Roles are read from the database on every request — never from JWT claims — so a
 * promotion or removal applies to the very next call. Missing membership masks as 404
 * so a non-member cannot distinguish "no workspace" from "not a member".
 */
@Service
@RequiredArgsConstructor
public class WorkspaceAccessService {

    private final WorkspaceMemberRepository memberRepository;
    private final EntityManager entityManager;

    /** A resolved membership plus the workspace it belongs to. */
    public record Membership(Workspace workspace, WorkspaceMember member) {}

    /**
     * Re-reads a managed membership after the caller has locked its workspace row. The
     * access check ran before that lock, so a demotion committed while this transaction
     * waited is not reflected in the already-loaded entity; the caller must re-check the
     * role on the refreshed membership before mutating.
     */
    @Transactional
    public void refreshForLock(WorkspaceMember member) {
        try {
            entityManager.refresh(member);
        } catch (EntityNotFoundException ex) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
    }

    /** Any member may read the workspace and its roster. */
    @Transactional(readOnly = true)
    public Membership requireMember(UUID userId) {
        WorkspaceMember member =
                memberRepository.findByUserId(userId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
        return new Membership(member.getWorkspace(), member);
    }

    /** Admin or owner. */
    @Transactional(readOnly = true)
    public Membership requireAdmin(UUID userId) {
        Membership membership = requireMember(userId);
        if (!membership.member().getRole().canManageMembers()) {
            throw new ApiException(ErrorCode.FORBIDDEN);
        }
        return membership;
    }

    /** Owner only: rename, icon, role changes. */
    @Transactional(readOnly = true)
    public Membership requireOwner(UUID userId) {
        Membership membership = requireMember(userId);
        if (membership.member().getRole() != WorkspaceRole.OWNER) {
            throw new ApiException(ErrorCode.FORBIDDEN);
        }
        return membership;
    }

    /**
     * Whether registration is invite-gated. The instance is initialized once any
     * membership exists: before that, the first account bootstraps as owner.
     */
    @Transactional(readOnly = true)
    public boolean isInitialized() {
        return memberRepository.count() > 0;
    }
}
