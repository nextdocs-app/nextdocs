package com.nextdocs.api.workspace.service;

import com.nextdocs.api.attachment.AttachmentScope;
import com.nextdocs.api.attachment.dto.response.AttachmentResponse;
import com.nextdocs.api.attachment.service.AttachmentService;
import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.RefreshTokenRepository;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.pageicon.PageIconType;
import com.nextdocs.api.pageicon.dto.response.PageIconResponse;
import com.nextdocs.api.pageicon.validation.PageIconValidator;
import com.nextdocs.api.workspace.dto.request.WorkspaceMemberRoleUpdateRequest;
import com.nextdocs.api.workspace.dto.request.WorkspaceUpdateRequest;
import com.nextdocs.api.workspace.dto.response.WorkspaceMemberResponse;
import com.nextdocs.api.workspace.dto.response.WorkspaceResponse;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.entity.WorkspaceMember;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import com.nextdocs.api.workspace.repository.WorkspaceRepository;
import com.nextdocs.api.workspace.service.WorkspaceAccessService.Membership;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * Workspace identity and membership administration.
 *
 * <p>Role mutations take a {@code SELECT ... FOR UPDATE} lock on the workspace row
 * before counting owners, so concurrent demotions or removals cannot both observe
 * "another owner still exists" and together leave the workspace ownerless.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class WorkspaceService {

    /** Name of the bootstrap/backfill workspace; the owner renames it in General. */
    public static final String DEFAULT_NAME = "NextDocs";

    private static final String LAST_OWNER_MESSAGE = "The workspace must keep at least one owner.";

    private final WorkspaceRepository workspaceRepository;
    private final WorkspaceMemberRepository memberRepository;
    private final UserRepository userRepository;
    private final RefreshTokenRepository refreshTokenRepository;
    private final WorkspaceAccessService accessService;
    private final PageIconValidator pageIconValidator;
    private final AttachmentService attachmentService;

    /**
     * Creates the workspace and makes {@code user} its owner when the instance has no
     * members yet: the first account bootstraps without an invite.
     *
     * <p>Called from the registration transaction. The check-then-insert is only
     * guarded per JVM, which is enough for a self-hosted instance running one API
     * replica: two concurrent first registrations on separate replicas would each
     * create a workspace.
     */
    @Transactional
    public void bootstrapFirstUser(User user) {
        if (accessService.isInitialized()) {
            return;
        }
        Workspace workspace = workspaceRepository
                .findFirstByOrderByCreatedAtAsc()
                .orElseGet(() -> workspaceRepository.save(
                        Workspace.builder().name(DEFAULT_NAME).build()));
        memberRepository.save(WorkspaceMember.builder()
                .workspace(workspace)
                .user(user)
                .role(WorkspaceRole.OWNER)
                .build());
        log.info("Bootstrapped workspace {} with owner {}", workspace.getId(), user.getId());
    }

    @Transactional(readOnly = true)
    public WorkspaceResponse getCurrent(UUID userId) {
        Membership membership = accessService.requireMember(userId);
        return toResponse(membership);
    }

    @Transactional
    public WorkspaceResponse updateCurrent(UUID userId, WorkspaceUpdateRequest request) {
        Membership membership = accessService.requireOwner(userId);
        UUID workspaceId = membership.workspace().getId();
        AttachmentScope scope = AttachmentScope.workspace(workspaceId);
        // Validate (and sniff the upload bytes) before taking the workspace row lock:
        // storage I/O must not serialize every role mutation and icon edit behind it.
        PageIconValidator.ValidatedIcon icon =
                request.icon() == null ? null : pageIconValidator.validateIcon(request.icon(), scope);
        // Serialized against role mutations and other icon edits: without the lock a
        // concurrent icon replace could clean up the upload the winner kept.
        Workspace workspace = workspaceRepository
                .findByIdForUpdate(workspaceId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));

        if (request.name() != null) {
            String name = request.name().strip();
            if (name.isEmpty()) {
                throw new ApiException(ErrorCode.VALIDATION_FAILED, "Workspace name must not be blank.");
            }
            workspace.setName(name);
        }
        if (icon != null) {
            // Validation ran before the lock; re-check the row (still scoped to this
            // workspace) under it so a concurrent delete cannot be adopted.
            if (icon.type() == PageIconType.UPLOAD) {
                pageIconValidator.validateUploadReference("Icon", icon.value(), scope);
            }
            applyIcon(workspace, icon);
        }

        return toResponse(new Membership(workspace, membership.member()));
    }

    /**
     * Stores an image the workspace icon can reference. Owner only: the icon is
     * instance identity, not content. The returned id is set through
     * {@link #updateCurrent} with type {@code UPLOAD}; the upload route is the only
     * way to obtain an id bound to this workspace.
     */
    public AttachmentResponse uploadAttachment(UUID userId, MultipartFile file) {
        return attachmentService.uploadWorkspaceAttachment(userId, file);
    }

    @Transactional(readOnly = true)
    public List<WorkspaceMemberResponse> listMembers(UUID userId) {
        Membership membership = accessService.requireMember(userId);
        return roster(workspaceId(membership));
    }

    @Transactional
    public List<WorkspaceMemberResponse> updateMemberRole(
            UUID actorId, UUID targetUserId, WorkspaceMemberRoleUpdateRequest request) {
        Membership actor = accessService.requireOwner(actorId);
        UUID workspaceId = workspaceId(actor);
        lockWorkspace(workspaceId);
        // The owner check above ran before the lock: another transaction may have
        // demoted the actor while this one waited, and the managed membership still
        // carries the old role.
        accessService.refreshForLock(actor.member());
        if (actor.member().getRole() != WorkspaceRole.OWNER) {
            throw new ApiException(ErrorCode.FORBIDDEN);
        }
        WorkspaceMember target = requireTarget(workspaceId, targetUserId);
        // The target may have been demoted or promoted while this transaction waited.
        accessService.refreshForLock(target);

        if (target.getUser().getId().equals(actorId)) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "You cannot change your own role.");
        }
        WorkspaceRole newRole = parseRole(request.role());
        if (target.getRole() == WorkspaceRole.OWNER && newRole != WorkspaceRole.OWNER && ownerCount(workspaceId) <= 1) {
            throw new ApiException(ErrorCode.CONFLICT, LAST_OWNER_MESSAGE);
        }
        target.setRole(newRole);
        memberRepository.save(target);
        return roster(workspaceId);
    }

    /**
     * Removal deletes the membership, deactivates the account, and revokes its refresh
     * tokens: access checks read membership on every request, so the removed user is
     * locked out immediately. A later invite for the same email reactivates the account.
     */
    @Transactional
    public List<WorkspaceMemberResponse> removeMember(UUID actorId, UUID targetUserId) {
        Membership actor = accessService.requireAdmin(actorId);
        UUID workspaceId = workspaceId(actor);
        lockWorkspace(workspaceId);
        // The admin check above ran before the lock: a demotion that committed while
        // this transaction waited must not let the actor remove anyone.
        accessService.refreshForLock(actor.member());
        if (!actor.member().getRole().canManageMembers()) {
            throw new ApiException(ErrorCode.FORBIDDEN);
        }
        WorkspaceMember target = requireTarget(workspaceId, targetUserId);
        accessService.refreshForLock(target);

        if (target.getUser().getId().equals(actorId)) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "You cannot remove yourself from the workspace.");
        }
        // Admins may only remove plain members; owners can remove anyone but themselves.
        if (target.getRole() != WorkspaceRole.MEMBER && actor.member().getRole() != WorkspaceRole.OWNER) {
            throw new ApiException(ErrorCode.FORBIDDEN);
        }
        if (target.getRole() == WorkspaceRole.OWNER && ownerCount(workspaceId) <= 1) {
            throw new ApiException(ErrorCode.CONFLICT, LAST_OWNER_MESSAGE);
        }

        User targetUser = target.getUser();
        memberRepository.delete(target);
        targetUser.setActive(false);
        userRepository.save(targetUser);
        refreshTokenRepository.revokeAllForUser(targetUserId);
        log.info("Removed user {} from workspace {}", targetUserId, workspaceId);
        return roster(workspaceId);
    }

    /**
     * Applies an already-validated icon: absent (null type) clears it. Uploads reference
     * an attachment that must belong to this workspace; the endpoint that stores one is
     * the only way to obtain such an id. Replacing or clearing an upload icon reclaims
     * the replaced file and its quota: workspaces have no document-style purge path that
     * would sweep it up later.
     */
    private void applyIcon(Workspace workspace, PageIconValidator.ValidatedIcon icon) {
        if (icon.type() == null) {
            releaseReplacedIconUpload(workspace, null);
            workspace.setIconType(null);
            workspace.setIconValue(null);
            workspace.setIconColor(null);
            return;
        }
        // Releasing after validation means a rejected new value leaves the old upload in
        // place. Re-setting the same id releases nothing.
        releaseReplacedIconUpload(workspace, icon.type() == PageIconType.UPLOAD ? icon.value() : null);
        workspace.setIconType(icon.type());
        workspace.setIconValue(icon.value());
        workspace.setIconColor(icon.color());
    }

    /**
     * Deletes the file behind the current upload icon unless {@code keepValue} is
     * that same id. The stored value is always one this class wrote through
     * {@link PageIconValidator#validateUpload}, so it parses as a UUID.
     */
    private void releaseReplacedIconUpload(Workspace workspace, String keepValue) {
        if (workspace.getIconType() != PageIconType.UPLOAD) {
            return;
        }
        String currentValue = workspace.getIconValue();
        if (currentValue == null || currentValue.equals(keepValue)) {
            return;
        }
        attachmentService.deleteWorkspaceUpload(UUID.fromString(currentValue));
    }

    private UUID workspaceId(Membership membership) {
        return membership.workspace().getId();
    }

    private void lockWorkspace(UUID workspaceId) {
        workspaceRepository.findByIdForUpdate(workspaceId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
    }

    private WorkspaceMember requireTarget(UUID workspaceId, UUID targetUserId) {
        return memberRepository
                .findByWorkspaceIdAndUserId(workspaceId, targetUserId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
    }

    private long ownerCount(UUID workspaceId) {
        return memberRepository.countByWorkspaceIdAndRole(workspaceId, WorkspaceRole.OWNER);
    }

    private static WorkspaceRole parseRole(String raw) {
        try {
            return WorkspaceRole.parse(raw);
        } catch (IllegalArgumentException ex) {
            throw new ApiException(
                    ErrorCode.VALIDATION_FAILED, "Unknown workspace role: " + PageIconValidator.echo(raw) + ".");
        }
    }

    private List<WorkspaceMemberResponse> roster(UUID workspaceId) {
        return memberRepository.findAllByWorkspaceIdOrderByCreatedAtAsc(workspaceId).stream()
                .map(WorkspaceService::toMemberResponse)
                .toList();
    }

    private WorkspaceResponse toResponse(Membership membership) {
        Workspace workspace = membership.workspace();
        return new WorkspaceResponse(
                workspace.getId(),
                workspace.getName(),
                toIconResponse(workspace),
                membership.member().getRole(),
                memberRepository.countByWorkspaceId(workspace.getId()));
    }

    private static PageIconResponse toIconResponse(Workspace workspace) {
        if (workspace.getIconType() == null) {
            return null;
        }
        return new PageIconResponse(
                workspace.getIconType().name().toLowerCase(Locale.ROOT),
                workspace.getIconValue(),
                workspace.getIconColor());
    }

    private static WorkspaceMemberResponse toMemberResponse(WorkspaceMember member) {
        User user = member.getUser();
        return new WorkspaceMemberResponse(
                user.getId(),
                user.getEmail(),
                user.getDisplayName(),
                user.getAvatarUrl(),
                member.getRole(),
                member.getCreatedAt());
    }
}
