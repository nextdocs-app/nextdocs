package com.nextdocs.api.space.service;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.dto.response.DocumentResponse;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.service.DocumentService;
import com.nextdocs.api.pageicon.dto.response.PageIconResponse;
import com.nextdocs.api.pageicon.validation.PageIconValidator;
import com.nextdocs.api.space.dto.request.SpaceCreateRequest;
import com.nextdocs.api.space.dto.request.SpaceMemberAccessUpdateRequest;
import com.nextdocs.api.space.dto.request.SpaceMemberCreateRequest;
import com.nextdocs.api.space.dto.request.SpaceUpdateRequest;
import com.nextdocs.api.space.dto.response.SpaceMemberResponse;
import com.nextdocs.api.space.dto.response.SpaceResponse;
import com.nextdocs.api.space.entity.Space;
import com.nextdocs.api.space.entity.SpaceAccessMode;
import com.nextdocs.api.space.entity.SpaceMember;
import com.nextdocs.api.space.repository.SpaceMemberRepository;
import com.nextdocs.api.space.repository.SpaceRepository;
import com.nextdocs.api.space.service.SpaceAccessService.SpaceContext;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import com.nextdocs.api.workspace.service.WorkspaceAccessService;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Spaces: an optional container of root pages with Public or Custom access.
 *
 * <p>Ownership mirrors the workspace: co-owners are allowed and the last owner can never
 * be demoted or removed. Both invariants are checked after a {@code SELECT ... FOR UPDATE}
 * on the space row, so two concurrent demotions cannot both observe "another owner still
 * exists" and leave the space ownerless.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SpaceService {

    private static final String LAST_OWNER_MESSAGE = "The space must keep at least one owner.";

    private static final String LAST_OWNER_LEAVE_MESSAGE = "Make another member an owner before leaving this space.";

    /** Levels a member row may carry; NO_ACCESS has nothing above it to shadow. */
    private static final Set<DocumentAccessLevel> MEMBER_LEVELS = Set.of(
            DocumentAccessLevel.VIEW, DocumentAccessLevel.COMMENT, DocumentAccessLevel.EDIT, DocumentAccessLevel.OWNER);

    /** Levels the everyone-else grant may carry: ownership stays with members. */
    private static final Set<DocumentAccessLevel> EVERYONE_LEVELS =
            Set.of(DocumentAccessLevel.VIEW, DocumentAccessLevel.COMMENT, DocumentAccessLevel.EDIT);

    private final SpaceRepository spaceRepository;
    private final SpaceMemberRepository memberRepository;
    private final DocumentRepository documentRepository;
    private final WorkspaceAccessService workspaceAccessService;
    private final WorkspaceMemberRepository workspaceMemberRepository;
    private final UserRepository userRepository;
    private final SpaceAccessService spaceAccessService;
    private final DocumentService documentService;
    private final PageIconValidator pageIconValidator;

    /**
     * Active spaces the caller can see, oldest first: their memberships, every PUBLIC
     * space of the workspace, and — for a workspace owner or admin — all of them, with
     * {@code myAccessLevel} null for the ones they are not part of.
     *
     * <p>With {@code archived=true} the result is the restore view instead: archived
     * spaces only, limited to the ones the caller can administer.
     */
    @Transactional(readOnly = true)
    public List<SpaceResponse> listSpaces(UUID userId, boolean archived) {
        WorkspaceAccessService.Membership membership = workspaceAccessService.requireMember(userId);
        Workspace workspace = membership.workspace();
        boolean workspaceAdmin = membership.member().getRole().canManageMembers();

        Map<UUID, DocumentAccessLevel> levels = memberLevels(userId);
        List<Space> spaces;
        if (archived) {
            // Filter in SQL: a plain member only restores the spaces they own, and loading
            // every archived space of the workspace just to discard it grows with history.
            spaces = workspaceAdmin
                    ? spaceRepository.findAllByWorkspace_IdAndArchivedAtIsNotNullOrderByArchivedAtDescIdDesc(
                            workspace.getId())
                    : spaceRepository.findArchivedOwnedByUser(workspace.getId(), userId);
        } else {
            spaces = workspaceAdmin
                    ? spaceRepository.findAllByWorkspace_IdAndArchivedAtIsNullOrderByCreatedAtAsc(workspace.getId())
                    : spaceRepository.findAllVisibleToUser(workspace.getId(), userId);
        }
        if (spaces.isEmpty()) {
            return List.of();
        }

        List<UUID> spaceIds = spaces.stream().map(Space::getId).toList();
        Map<UUID, Long> memberCounts = fetchMemberCounts(spaceIds);
        Map<UUID, Long> pageCounts = fetchPageCounts(spaceIds);

        List<SpaceResponse> responses = new ArrayList<>(spaces.size());
        for (Space space : spaces) {
            DocumentAccessLevel level = levels.get(space.getId());
            if (level == null && space.getAccessMode() == SpaceAccessMode.PUBLIC) {
                level = space.getEveryoneAccessLevel();
            }
            responses.add(toResponse(
                    space,
                    level,
                    workspaceAdmin || level == DocumentAccessLevel.OWNER,
                    memberCounts.getOrDefault(space.getId(), 0L),
                    pageCounts.getOrDefault(space.getId(), 0L)));
        }
        return responses;
    }

    /** Space detail. Read access, or workspace administration for a space not joined. */
    @Transactional(readOnly = true)
    public SpaceResponse getSpace(UUID userId, UUID spaceId) {
        SpaceContext context = spaceAccessService.requireRead(userId, spaceId);
        return toResponse(context);
    }

    /**
     * Archives a space: hidden from normal navigation, readable but frozen. Pages,
     * memberships, attachments, and access rules stay in place. Idempotent.
     */
    @Transactional
    public SpaceResponse archiveSpace(UUID userId, UUID spaceId) {
        spaceAccessService.requireAdministration(userId, spaceId);
        Space space = lockSpace(spaceId);
        // Re-check after the row lock: a demotion committed while this transaction
        // waited must not ride along with the archive.
        SpaceContext lockedContext = spaceAccessService.requireAdministration(userId, spaceId);

        if (space.getArchivedAt() == null) {
            space.setArchivedAt(OffsetDateTime.now(ZoneOffset.UTC));
            space.setArchivedBy(userRepository
                    .findById(userId)
                    .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Acting user not found.")));
            spaceRepository.save(space);
            log.info("Archived space {} by {}", spaceId, userId);
        }
        return toResponse(
                space,
                spaceAccessService.resolveLevel(userId, space),
                lockedContext.canAdminister(),
                memberRepository.countBySpace_Id(spaceId),
                documentRepository.countBySpace_IdAndDeletedAtIsNull(spaceId));
    }

    /** Restores an archived space to normal navigation and writes. Idempotent. */
    @Transactional
    public SpaceResponse restoreSpace(UUID userId, UUID spaceId) {
        spaceAccessService.requireAdministration(userId, spaceId);
        Space space = lockSpace(spaceId);
        SpaceContext lockedContext = spaceAccessService.requireAdministration(userId, spaceId);

        if (space.getArchivedAt() != null) {
            space.setArchivedAt(null);
            space.setArchivedBy(null);
            spaceRepository.save(space);
            log.info("Restored space {} by {}", spaceId, userId);
        }
        return toResponse(
                space,
                spaceAccessService.resolveLevel(userId, space),
                lockedContext.canAdminister(),
                memberRepository.countBySpace_Id(spaceId),
                documentRepository.countBySpace_IdAndDeletedAtIsNull(spaceId));
    }

    /**
     * Creates the space and makes the caller its first owner. The caller must be a
     * workspace member (already guaranteed by the access service).
     */
    @Transactional
    public SpaceResponse createSpace(UUID userId, SpaceCreateRequest request) {
        WorkspaceAccessService.Membership membership = workspaceAccessService.requireMember(userId);
        Workspace workspace = membership.workspace();
        User creator = membership.member().getUser();

        String name = normalizeName(request.name());
        PageIconValidator.ValidatedIcon icon =
                request.icon() == null ? null : pageIconValidator.validateSpaceIcon(request.icon());
        SpaceAccessMode accessMode = request.accessMode() == null ? SpaceAccessMode.CUSTOM : request.accessMode();
        DocumentAccessLevel everyoneLevel = request.everyoneAccessLevel() == null
                ? DocumentAccessLevel.VIEW
                : normalizeEveryoneLevel(request.everyoneAccessLevel());

        Space space = Space.builder()
                .workspace(workspace)
                .name(name)
                .accessMode(accessMode)
                .everyoneAccessLevel(everyoneLevel)
                .build();
        applyIcon(space, icon);
        Space saved = spaceRepository.save(space);

        memberRepository.save(SpaceMember.builder()
                .space(saved)
                .user(creator)
                .accessLevel(DocumentAccessLevel.OWNER)
                .build());

        log.info("Created space {} in workspace {} owned by {}", saved.getId(), workspace.getId(), userId);
        return toResponse(saved, DocumentAccessLevel.OWNER, true, 1L, 0L);
    }

    /** Renames, re-shares, or re-icons a space. Space owner or workspace admin. */
    @Transactional
    public SpaceResponse updateSpace(UUID userId, UUID spaceId, SpaceUpdateRequest request) {
        SpaceContext context = spaceAccessService.requireActiveAdministration(userId, spaceId);
        UUID workspaceId = context.space().getWorkspace().getId();

        // Validate icon bytes and level values before taking the row lock: storage I/O
        // and pure validation must not serialize every membership change behind them.
        PageIconValidator.ValidatedIcon icon =
                request.icon() == null ? null : pageIconValidator.validateSpaceIcon(request.icon());
        DocumentAccessLevel everyoneLevel =
                request.everyoneAccessLevel() == null ? null : normalizeEveryoneLevel(request.everyoneAccessLevel());
        String name = request.name() == null ? null : normalizeName(request.name());

        Space space = lockSpace(spaceId);
        if (!space.getWorkspace().getId().equals(workspaceId)) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
        // The pre-lock check ran before this transaction waited on the row: re-check after
        // taking the lock so a demotion committed in between cannot ride along.
        SpaceContext lockedContext = spaceAccessService.requireActiveAdministration(userId, spaceId);

        if (name != null) {
            space.setName(name);
        }
        if (request.accessMode() != null) {
            space.setAccessMode(request.accessMode());
        }
        if (everyoneLevel != null) {
            space.setEveryoneAccessLevel(everyoneLevel);
        }
        if (icon != null) {
            applyIcon(space, icon);
        }

        Space saved = spaceRepository.save(space);
        return toResponse(
                saved,
                spaceAccessService.resolveLevel(userId, saved),
                lockedContext.canAdminister(),
                memberRepository.countBySpace_Id(spaceId),
                documentRepository.countBySpace_IdAndDeletedAtIsNull(spaceId));
    }

    /**
     * Deletes a space only when it is truly empty: no document row may still reference
     * it. Trashed pages keep their space_id, so they block deletion until they are
     * permanently deleted. A populated space must be archived instead.
     */
    @Transactional
    public void deleteSpace(UUID userId, UUID spaceId) {
        Space space = lockSpace(spaceId);
        // Checked under the lock: a space member promoted while this transaction waited
        // must be able to administer the deletion it is holding the row for.
        spaceAccessService.requireAdministration(userId, spaceId);

        long remainingPages = documentRepository.countBySpace_Id(spaceId);
        if (remainingPages > 0) {
            throw new ApiException(
                    ErrorCode.CONFLICT,
                    "This space still contains pages, including pages in trash. "
                            + "Permanently delete them first, or archive the space.");
        }

        spaceRepository.delete(space);
        log.info("Deleted empty space {}", spaceId);
    }

    /**
     * Member roster. Listed members and workspace admins only: a Public space grants
     * content read to the whole workspace, and that is not the same as handing every
     * reader the roster of who was deliberately added.
     */
    @Transactional(readOnly = true)
    public List<SpaceMemberResponse> listMembers(UUID userId, UUID spaceId) {
        spaceAccessService.requireRoster(userId, spaceId);
        return roster(spaceId);
    }

    /**
     * Adds an existing workspace member to the space. Adding somebody who is already
     * listed is a conflict: changing their level is an update, and silently demoting an
     * owner through an "add" would be a surprise.
     */
    @Transactional
    public List<SpaceMemberResponse> addMember(UUID userId, UUID spaceId, SpaceMemberCreateRequest request) {
        SpaceContext context = spaceAccessService.requireActiveAdministration(userId, spaceId);
        DocumentAccessLevel level = normalizeMemberLevel(request.accessLevel());

        User target = userRepository
                .findByEmail(request.email().strip().toLowerCase(Locale.ROOT))
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "User not found for the provided email."));
        if (workspaceMemberRepository
                .findByWorkspaceIdAndUserId(context.space().getWorkspace().getId(), target.getId())
                .isEmpty()) {
            throw new ApiException(ErrorCode.NOT_FOUND, "That person is not a member of this workspace.");
        }

        // Take the row lock before writing the membership: an archive that commits
        // while this transaction waited must not leave a member on a frozen space.
        Space space = lockSpace(spaceId);
        spaceAccessService.requireActiveAdministration(userId, spaceId);

        if (memberRepository.existsBySpace_IdAndUser_Id(spaceId, target.getId())) {
            throw new ApiException(ErrorCode.CONFLICT, "That person is already a member of this space.");
        }

        User actor = userRepository
                .findById(userId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Acting user not found."));
        memberRepository.save(SpaceMember.builder()
                .space(space)
                .user(target)
                .accessLevel(level)
                .grantedBy(actor)
                .build());
        return roster(spaceId);
    }

    /**
     * Changes a member's level. Space owner or workspace admin; an owner may demote
     * themselves as long as another owner remains. The last owner can never be demoted,
     * checked under the space row lock so two concurrent demotions cannot both pass.
     */
    @Transactional
    public List<SpaceMemberResponse> updateMemberAccess(
            UUID userId, UUID spaceId, UUID targetUserId, SpaceMemberAccessUpdateRequest request) {
        spaceAccessService.requireActiveAdministration(userId, spaceId);
        Space space = lockSpace(spaceId);
        spaceAccessService.requireActiveAdministration(userId, spaceId);

        DocumentAccessLevel newLevel = normalizeMemberLevel(request.accessLevel());
        SpaceMember target = requireMember(space, targetUserId);
        if (target.getAccessLevel() == DocumentAccessLevel.OWNER
                && newLevel != DocumentAccessLevel.OWNER
                && ownerCount(spaceId) <= 1) {
            throw new ApiException(ErrorCode.CONFLICT, LAST_OWNER_MESSAGE);
        }
        target.setAccessLevel(newLevel);
        memberRepository.save(target);
        return roster(spaceId);
    }

    /**
     * Removes a member. Space owner or workspace admin, or the member themselves
     * (leaving). The last owner can never leave or be removed.
     */
    @Transactional
    public List<SpaceMemberResponse> removeMember(UUID userId, UUID spaceId, UUID targetUserId) {
        boolean self = userId.equals(targetUserId);
        if (self) {
            // Leaving is a read-adjacent act: any member may do it, and a workspace
            // admin who is not a member has nothing to leave. It stays available in an
            // archived space so a member is never trapped there.
            spaceAccessService.requireRead(userId, spaceId);
        } else {
            spaceAccessService.requireActiveAdministration(userId, spaceId);
        }

        Space space = lockSpace(spaceId);
        if (!self) {
            spaceAccessService.requireActiveAdministration(userId, spaceId);
        }

        SpaceMember target = requireMember(space, targetUserId);
        if (target.getAccessLevel() == DocumentAccessLevel.OWNER && ownerCount(spaceId) <= 1) {
            throw new ApiException(ErrorCode.CONFLICT, self ? LAST_OWNER_LEAVE_MESSAGE : LAST_OWNER_MESSAGE);
        }
        memberRepository.delete(target);
        return roster(spaceId);
    }

    /**
     * Files an existing root page into the space. The row lock serializes an archive or
     * delete of this space; the page rules and the single permission gate live in
     * {@link DocumentService#assignSpace}.
     */
    @Transactional
    public DocumentResponse attachPage(UUID userId, UUID spaceId, UUID documentId) {
        lockSpace(spaceId);
        return documentService.assignSpace(userId, documentId, spaceId);
    }

    /**
     * Detaches a page from its space; it returns to the owner's Private section. Like
     * attach, the lock keeps an archive from committing between the gate and the write.
     */
    @Transactional
    public void detachPage(UUID userId, UUID spaceId, UUID documentId) {
        lockSpace(spaceId);
        documentService.clearSpace(userId, documentId, spaceId);
    }

    /**
     * Row-locks the space and re-reads it. Archive and delete take the same lock, so
     * the active-space gates cannot go stale between their read and the write; the
     * refresh is required because a pre-lock check has already put the space in the
     * persistence context, where the lock query does not overwrite its old state.
     */
    private Space lockSpace(UUID spaceId) {
        Space space =
                spaceRepository.findByIdForUpdate(spaceId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
        spaceAccessService.refreshForLock(space);
        return space;
    }

    private List<SpaceMemberResponse> roster(UUID spaceId) {
        return memberRepository.findAllBySpace_IdOrderByCreatedAtAsc(spaceId).stream()
                .map(SpaceService::toMemberResponse)
                .toList();
    }

    private SpaceMember requireMember(Space space, UUID targetUserId) {
        return memberRepository
                .findBySpace_IdAndUser_Id(space.getId(), targetUserId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Space member not found."));
    }

    private long ownerCount(UUID spaceId) {
        return memberRepository.countBySpace_IdAndAccessLevel(spaceId, DocumentAccessLevel.OWNER);
    }

    private SpaceResponse toResponse(SpaceContext context) {
        Space space = context.space();
        return toResponse(
                space,
                context.accessLevel(),
                context.canAdminister(),
                memberRepository.countBySpace_Id(space.getId()),
                documentRepository.countBySpace_IdAndDeletedAtIsNull(space.getId()));
    }

    private Map<UUID, DocumentAccessLevel> memberLevels(UUID userId) {
        Map<UUID, DocumentAccessLevel> levels = new HashMap<>();
        for (SpaceMember member : memberRepository.findAllByUser_Id(userId)) {
            levels.put(member.getSpace().getId(), member.getAccessLevel());
        }
        return levels;
    }

    private Map<UUID, Long> fetchMemberCounts(List<UUID> spaceIds) {
        Map<UUID, Long> counts = new HashMap<>();
        for (Object[] row : memberRepository.countMembersBySpaceIds(spaceIds)) {
            counts.put((UUID) row[0], ((Number) row[1]).longValue());
        }
        return counts;
    }

    private Map<UUID, Long> fetchPageCounts(List<UUID> spaceIds) {
        Map<UUID, Long> counts = new HashMap<>();
        for (Object[] row : documentRepository.countNonTrashedBySpaceIds(spaceIds)) {
            counts.put((UUID) row[0], ((Number) row[1]).longValue());
        }
        return counts;
    }

    private static SpaceResponse toResponse(
            Space space, DocumentAccessLevel myAccessLevel, boolean canAdminister, long memberCount, long pageCount) {
        // An archived space caps content at VIEW; reporting the pre-archive membership
        // level as "effective" would advertise a write grant the page endpoints deny.
        // canAdminister stays the restore flag.
        DocumentAccessLevel effectiveLevel =
                myAccessLevel != null && space.getArchivedAt() != null ? DocumentAccessLevel.VIEW : myAccessLevel;
        return new SpaceResponse(
                space.getId(),
                space.getName(),
                toIconResponse(space),
                space.getAccessMode(),
                space.getEveryoneAccessLevel(),
                effectiveLevel,
                canAdminister,
                memberCount,
                pageCount,
                space.getArchivedAt(),
                space.getCreatedAt(),
                space.getUpdatedAt());
    }

    private static SpaceMemberResponse toMemberResponse(SpaceMember member) {
        User user = member.getUser();
        return new SpaceMemberResponse(
                user.getId(),
                user.getEmail(),
                user.getDisplayName(),
                user.getAvatarUrl(),
                member.getAccessLevel(),
                member.getCreatedAt());
    }

    /**
     * Applies an already-validated icon: a value with a null type clears it. Spaces accept
     * emoji, builtin, and link icons for now; uploads need an attachment scope spaces do
     * not carry yet (see {@link PageIconValidator#validateSpaceIcon}).
     */
    private static void applyIcon(Space space, PageIconValidator.ValidatedIcon icon) {
        if (icon == null) {
            return;
        }
        if (icon.type() == null) {
            space.setIconType(null);
            space.setIconValue(null);
            space.setIconColor(null);
            return;
        }
        space.setIconType(icon.type());
        space.setIconValue(icon.value());
        space.setIconColor(icon.color());
    }

    private static PageIconResponse toIconResponse(Space space) {
        if (space.getIconType() == null) {
            return null;
        }
        return new PageIconResponse(
                space.getIconType().name().toLowerCase(Locale.ROOT), space.getIconValue(), space.getIconColor());
    }

    private static String normalizeName(String raw) {
        String name = raw == null ? "" : raw.strip();
        if (name.isEmpty()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Space name must not be blank.");
        }
        return name;
    }

    private static DocumentAccessLevel normalizeMemberLevel(DocumentAccessLevel level) {
        if (level == null) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "accessLevel is required.");
        }
        if (!MEMBER_LEVELS.contains(level)) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "NO_ACCESS is not a space membership level.");
        }
        return level;
    }

    private static DocumentAccessLevel normalizeEveryoneLevel(DocumentAccessLevel level) {
        if (!EVERYONE_LEVELS.contains(level)) {
            throw new ApiException(
                    ErrorCode.VALIDATION_FAILED,
                    "The everyone-else level must be VIEW, COMMENT, or EDIT; ownership belongs to members.");
        }
        return level;
    }
}
