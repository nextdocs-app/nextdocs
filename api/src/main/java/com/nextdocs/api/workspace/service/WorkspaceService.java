package com.nextdocs.api.workspace.service;

import com.nextdocs.api.attachment.AttachmentScope;
import com.nextdocs.api.attachment.dto.response.AttachmentResponse;
import com.nextdocs.api.attachment.entity.Attachment;
import com.nextdocs.api.attachment.service.AttachmentService;
import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.RefreshTokenRepository;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.pageicon.PageIconType;
import com.nextdocs.api.pageicon.dto.response.PageIconResponse;
import com.nextdocs.api.pageicon.validation.PageIconValidator;
import com.nextdocs.api.space.entity.Space;
import com.nextdocs.api.space.entity.SpaceAccessMode;
import com.nextdocs.api.space.entity.SpaceMember;
import com.nextdocs.api.space.repository.SpaceMemberRepository;
import com.nextdocs.api.space.repository.SpaceRepository;
import com.nextdocs.api.workspace.dto.request.WorkspaceMemberRoleUpdateRequest;
import com.nextdocs.api.workspace.dto.request.WorkspaceUpdateRequest;
import com.nextdocs.api.workspace.dto.response.WorkspaceBrandingResponse;
import com.nextdocs.api.workspace.dto.response.WorkspaceMemberResponse;
import com.nextdocs.api.workspace.dto.response.WorkspaceMemberSpaceSummaryResponse;
import com.nextdocs.api.workspace.dto.response.WorkspaceResponse;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.entity.WorkspaceMember;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import com.nextdocs.api.workspace.repository.InstanceLockRepository;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import com.nextdocs.api.workspace.repository.WorkspaceRepository;
import com.nextdocs.api.workspace.service.WorkspaceAccessService.Membership;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
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

    private static final String LAST_OWNER_MESSAGE = "The workspace must keep at least one owner.";

    private static final String LAST_OWNER_SELF_DEMOTE_MESSAGE =
            "Make another member an owner before demoting yourself.";

    private final WorkspaceRepository workspaceRepository;
    private final WorkspaceMemberRepository memberRepository;
    private final UserRepository userRepository;
    private final RefreshTokenRepository refreshTokenRepository;
    private final WorkspaceAccessService accessService;
    private final PageIconValidator pageIconValidator;
    private final AttachmentService attachmentService;
    private final InstanceLockRepository instanceLockRepository;
    private final SpaceMemberRepository spaceMemberRepository;
    private final SpaceRepository spaceRepository;

    /**
     * How long an uploaded icon may sit unapplied before the nightly sweep deletes it.
     * Long enough for an owner to upload and finish the edit; short enough that an
     * abandoned upload does not hold disk and quota forever.
     */
    @Value("${app.workspaces.icon-upload-grace-hours:24}")
    private long iconUploadGraceHours = 24;

    /**
     * Creates the workspace and makes {@code user} its owner when the instance has no
     * members yet: the first account bootstraps without an invite.
     *
     * <p>Called from the registration transaction. The caller's preliminary check can
     * race with another first registration, so this method re-checks under a pessimistic
     * lock on the V22 singleton row: on an empty database there is no workspace row to
     * lock, and without one two requests would both create a workspace. READ_COMMITTED
     * is pinned so that re-check sees the winner's membership after waiting for the lock;
     * under REPEATABLE READ it could still read a pre-lock snapshot.
     *
     * @return {@code true} when this call bootstrapped the instance; {@code false} when
     *     another registration won, in which case the caller must not admit the account
     */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public boolean bootstrapFirstUser(User user) {
        instanceLockRepository
                .lockForUpdate()
                .orElseThrow(() -> new IllegalStateException("instance_lock row is missing (V22)"));
        if (accessService.isInitialized()) {
            return false;
        }
        // Insert the account only after winning the lock: a same-email racer that
        // inserts first would otherwise hit uq_users_email before re-checking.
        userRepository.save(user);
        Workspace workspace = workspaceRepository
                .findFirstByOrderByCreatedAtAsc()
                .orElseGet(() -> workspaceRepository.save(
                        Workspace.builder().name(defaultWorkspaceName(user)).build()));
        memberRepository.save(WorkspaceMember.builder()
                .workspace(workspace)
                .user(user)
                .role(WorkspaceRole.OWNER)
                .build());
        log.info("Bootstrapped workspace {} with owner {}", workspace.getId(), user.getId());
        return true;
    }

    /**
     * Names the fresh workspace after the account that created it. The name is visible in
     * the sidebar and on invitations, so a product name there reads like branding the
     * owner may never replace; their own name is clearly theirs to edit in General.
     *
     * <p>Registration requires a display name, so the fallback only guards other callers.
     */
    private static String defaultWorkspaceName(User user) {
        String displayName =
                user.getDisplayName() == null ? "" : user.getDisplayName().strip();
        return displayName.isEmpty() ? "My workspace" : displayName + "'s workspace";
    }

    /** Adds a user admitted by an invite, carrying the invite's role. */
    @Transactional
    public void addMember(Workspace workspace, User user, WorkspaceRole role) {
        memberRepository.save(WorkspaceMember.builder()
                .workspace(workspace)
                .user(user)
                .role(role)
                .build());
    }

    @Transactional(readOnly = true)
    public WorkspaceResponse getCurrent(UUID userId) {
        Membership membership = accessService.requireMember(userId);
        return toResponse(membership);
    }

    /**
     * Workspace identity for the public document read. Deliberately no membership check:
     * the icon is branding, not content, and its attachment is marked public when the
     * icon adopts it. Empty when the instance has not been initialized, so a document
     * read never fails just because the branding row is absent.
     */
    @Transactional(readOnly = true)
    public Optional<WorkspaceBrandingResponse> findPublicBranding() {
        return workspaceRepository
                .findFirstByOrderByCreatedAtAsc()
                .map(workspace -> new WorkspaceBrandingResponse(
                        workspace.getName(),
                        PageIconResponse.from(
                                workspace.getIconType(), workspace.getIconValue(), workspace.getIconColor())));
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
     * way to obtain an id bound to this workspace. Private until then: an upload the
     * owner abandons before saving stays invisible to share pages and is swept later.
     */
    public AttachmentResponse uploadAttachment(UUID userId, MultipartFile file) {
        return attachmentService.uploadWorkspaceAttachment(userId, file);
    }

    /**
     * Sweeps workspace icon uploads nobody applied (or uploaded twice before saving): the
     * workspace icon and its spaces' icons are the only things that can reference one, so
     * every upload older than the grace period that no icon renders is dead.
     *
     * <p>Each workspace is read with a row lock, the same lock the workspace icon update takes
     * and that space create and update operations take before touching the space row when
     * they adopt or release an upload. Those applies serialize with the sweep instead of
     * racing its reference read and file delete.
     *
     * @return number of uploads deleted
     */
    @Transactional
    public int purgeAbandonedIconUploads() {
        OffsetDateTime cutoff = OffsetDateTime.now().minusHours(iconUploadGraceHours);
        List<Attachment> uploads = attachmentService.findWorkspaceUploadsCreatedBefore(cutoff);
        if (uploads.isEmpty()) {
            return 0;
        }
        Map<UUID, Workspace> workspaces = new HashMap<>();
        Map<UUID, Set<String>> spaceIconValues = new HashMap<>();
        for (UUID workspaceId : uploads.stream()
                .map(upload -> upload.getWorkspace().getId())
                .distinct()
                .toList()) {
            workspaceRepository.findByIdForUpdate(workspaceId).ifPresent(w -> workspaces.put(workspaceId, w));
            // Read under the workspace lock, like a space create or update that adopts or
            // releases an upload: neither can commit between this read and the delete.
            spaceIconValues.put(
                    workspaceId,
                    new HashSet<>(
                            spaceRepository.findIconValueByWorkspace_IdAndIconType(workspaceId, PageIconType.UPLOAD)));
        }

        int purged = 0;
        for (Attachment upload : uploads) {
            UUID workspaceId = upload.getWorkspace().getId();
            Workspace workspace = workspaces.get(workspaceId);
            String uploadId = upload.getId().toString();
            if (workspace != null && uploadId.equals(currentUploadIconId(workspace))) {
                continue;
            }
            if (spaceIconValues.getOrDefault(workspaceId, Set.of()).contains(uploadId)) {
                continue;
            }
            attachmentService.deleteWorkspaceUpload(workspaceId, upload.getId());
            purged++;
        }
        return purged;
    }

    @Transactional(readOnly = true)
    public List<WorkspaceMemberResponse> listMembers(UUID userId) {
        Membership membership = accessService.requireMember(userId);
        return roster(workspaceId(membership), membership.member().getRole().canManageMembers());
    }

    /**
     * Changes {@code targetUserId}'s role. Owner only. An owner may change their own
     * role: that is the hand-over path — promote another member to owner, then step
     * down. The one refusal is demoting the last owner, which is always the caller
     * themselves, because the workspace must never be left ownerless.
     */
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

        WorkspaceRole newRole = parseRole(request.role());
        if (target.getRole() == WorkspaceRole.OWNER && newRole != WorkspaceRole.OWNER && ownerCount(workspaceId) <= 1) {
            throw new ApiException(ErrorCode.CONFLICT, LAST_OWNER_SELF_DEMOTE_MESSAGE);
        }
        target.setRole(newRole);
        memberRepository.save(target);
        return roster(workspaceId, true);
    }

    /**
     * Removal deletes the membership, deactivates the account, and revokes its refresh
     * tokens: access checks read membership on every request, so the removed user is
     * locked out immediately. A later invite for the same email reactivates the account.
     *
     * <p>Space memberships go with it. A space left without an owner stays administrable
     * through the workspace owner/admin override, so off-boarding never needs to be
     * refused for the sake of a space.
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
        spaceMemberRepository.deleteByUser_Id(targetUserId);
        targetUser.setActive(false);
        userRepository.save(targetUser);
        refreshTokenRepository.revokeAllForUser(targetUserId);
        log.info("Removed user {} from workspace {}", targetUserId, workspaceId);
        return roster(workspaceId, true);
    }

    /**
     * Applies an already-validated icon: absent (null type) clears it. Uploads reference
     * an attachment that must belong to this workspace; the endpoint that stores one is
     * the only way to obtain such an id, and adopting it publishes the file for
     * anonymous share pages. Replacing or clearing an upload icon reclaims the replaced
     * file and its quota unless a space icon still renders that same upload.
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
        // place. Re-setting the same id releases nothing. The adopted upload becomes
        // public only here, under the workspace lock, never at upload time.
        releaseReplacedIconUpload(workspace, icon.type() == PageIconType.UPLOAD ? icon.value() : null);
        if (icon.type() == PageIconType.UPLOAD) {
            attachmentService.publishWorkspaceUpload(workspace.getId(), UUID.fromString(icon.value()));
        }
        workspace.setIconType(icon.type());
        workspace.setIconValue(icon.value());
        workspace.setIconColor(icon.color());
    }

    /**
     * Deletes the file behind the current upload icon unless {@code keepValue} is
     * that same id or a space still renders it. The workspace icon and every space
     * share one upload bucket, so reclaiming a file a space icon shows would break
     * that icon. The stored value is always one this class wrote through
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
        if (spaceRepository.existsByWorkspace_IdAndIconTypeAndIconValue(
                workspace.getId(), PageIconType.UPLOAD, currentValue)) {
            // The file stays for the space icon, but the workspace icon was what made it
            // anonymous branding: demote it so share links cannot read it any more.
            attachmentService.restrictWorkspaceUpload(workspace.getId(), UUID.fromString(currentValue));
            return;
        }
        attachmentService.deleteWorkspaceUpload(workspace.getId(), UUID.fromString(currentValue));
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

    /**
     * Builds the roster, optionally with each member's spaces.
     *
     * <p>Space memberships are disclosed to owners and admins only: who belongs to a
     * space is roster data, not content, so a plain member — who may read a public
     * space's pages — must not learn its member list. This mirrors
     * {@code SpaceAccessService#requireRoster}, which answers 403 to exactly that
     * caller. For everyone else {@code spaces} stays null and Jackson omits it.
     *
     * <p>Archived spaces are left out: they are hidden from navigation, so a member
     * summary would list a space the reader cannot open.
     */
    private List<WorkspaceMemberResponse> roster(UUID workspaceId, boolean includeSpaces) {
        List<WorkspaceMember> members = memberRepository.findAllByWorkspaceIdOrderByCreatedAtAsc(workspaceId);
        if (members.isEmpty()) {
            return List.of();
        }
        if (!includeSpaces) {
            return members.stream()
                    .map(member -> toMemberResponse(member, null))
                    .toList();
        }

        List<Space> spaces = spaceRepository.findAllByWorkspace_IdAndArchivedAtIsNullOrderByCreatedAtAsc(workspaceId);
        List<SpaceMember> spaceMembers = spaceMemberRepository.findAllBySpace_Workspace_Id(workspaceId);

        Map<UUID, Map<UUID, DocumentAccessLevel>> userSpaceAccess = new HashMap<>();
        for (SpaceMember spaceMember : spaceMembers) {
            userSpaceAccess
                    .computeIfAbsent(spaceMember.getUser().getId(), k -> new HashMap<>())
                    .put(spaceMember.getSpace().getId(), spaceMember.getAccessLevel());
        }

        return members.stream()
                .map(member -> toMemberResponse(member, spacesFor(member, spaces, userSpaceAccess)))
                .toList();
    }

    /**
     * The spaces a member belongs to, oldest first. An explicit membership wins over a
     * public space's everyone-else grant: promotion above the default is the whole point
     * of listing somebody on a public space.
     */
    private static List<WorkspaceMemberSpaceSummaryResponse> spacesFor(
            WorkspaceMember member, List<Space> spaces, Map<UUID, Map<UUID, DocumentAccessLevel>> userSpaceAccess) {
        Map<UUID, DocumentAccessLevel> explicitLevels =
                userSpaceAccess.getOrDefault(member.getUser().getId(), Map.of());
        List<WorkspaceMemberSpaceSummaryResponse> memberSpaces = new ArrayList<>();

        for (Space space : spaces) {
            DocumentAccessLevel explicitLevel = explicitLevels.get(space.getId());
            DocumentAccessLevel level = explicitLevel != null
                    ? explicitLevel
                    : space.getAccessMode() == SpaceAccessMode.PUBLIC ? space.getEveryoneAccessLevel() : null;
            if (level != null) {
                memberSpaces.add(new WorkspaceMemberSpaceSummaryResponse(
                        space.getId(),
                        space.getName(),
                        PageIconResponse.from(space.getIconType(), space.getIconValue(), space.getIconColor()),
                        level));
            }
        }
        return memberSpaces;
    }

    private WorkspaceResponse toResponse(Membership membership) {
        Workspace workspace = membership.workspace();
        return new WorkspaceResponse(
                workspace.getId(),
                workspace.getName(),
                PageIconResponse.from(workspace.getIconType(), workspace.getIconValue(), workspace.getIconColor()),
                membership.member().getRole(),
                memberRepository.countByWorkspaceId(workspace.getId()));
    }

    /** The attachment id the current upload icon points at, or null for any other icon. */
    private static String currentUploadIconId(Workspace workspace) {
        return workspace.getIconType() == PageIconType.UPLOAD ? workspace.getIconValue() : null;
    }

    private static WorkspaceMemberResponse toMemberResponse(
            WorkspaceMember member, List<WorkspaceMemberSpaceSummaryResponse> spaces) {
        User user = member.getUser();
        return new WorkspaceMemberResponse(
                user.getId(),
                user.getEmail(),
                user.getDisplayName(),
                user.getAvatarUrl(),
                member.getRole(),
                member.getCreatedAt(),
                spaces);
    }
}
