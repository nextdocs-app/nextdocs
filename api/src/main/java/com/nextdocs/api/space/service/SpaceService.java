package com.nextdocs.api.space.service;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.dto.response.DocumentResponse;
import com.nextdocs.api.document.entity.Document;
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
     * Spaces the caller can see, oldest first: their memberships, every PUBLIC space of
     * the workspace, and — for a workspace owner or admin — all of them, with
     * {@code myAccessLevel} null for the ones they are not part of.
     */
    @Transactional(readOnly = true)
    public List<SpaceResponse> listSpaces(UUID userId) {
        WorkspaceAccessService.Membership membership = workspaceAccessService.requireMember(userId);
        Workspace workspace = membership.workspace();
        boolean workspaceAdmin = membership.member().getRole().canManageMembers();

        List<Space> spaces = workspaceAdmin
                ? spaceRepository.findAllByWorkspace_IdOrderByCreatedAtAsc(workspace.getId())
                : spaceRepository.findAllVisibleToUser(workspace.getId(), userId);
        if (spaces.isEmpty()) {
            return List.of();
        }

        List<UUID> spaceIds = spaces.stream().map(Space::getId).toList();
        Map<UUID, DocumentAccessLevel> levels = new HashMap<>();
        for (SpaceMember member : memberRepository.findAllByUser_Id(userId)) {
            levels.put(member.getSpace().getId(), member.getAccessLevel());
        }
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
        SpaceContext context = spaceAccessService.requireAdministration(userId, spaceId);
        UUID workspaceId = context.space().getWorkspace().getId();

        // Validate icon bytes and level values before taking the row lock: storage I/O
        // and pure validation must not serialize every membership change behind them.
        PageIconValidator.ValidatedIcon icon =
                request.icon() == null ? null : pageIconValidator.validateSpaceIcon(request.icon());
        DocumentAccessLevel everyoneLevel =
                request.everyoneAccessLevel() == null ? null : normalizeEveryoneLevel(request.everyoneAccessLevel());
        String name = request.name() == null ? null : normalizeName(request.name());

        Space space =
                spaceRepository.findByIdForUpdate(spaceId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
        if (!space.getWorkspace().getId().equals(workspaceId)) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
        // The pre-lock check ran before this transaction waited on the row: re-check after
        // taking the lock so a demotion committed in between cannot ride along.
        SpaceContext lockedContext = spaceAccessService.requireAdministration(userId, spaceId);

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
     * Deletes a space. Refuses while it still holds pages unless the caller explicitly
     * asks to delete them, in which case every root page is trashed (the existing cascade
     * takes its descendants) and the space is removed. The trashed pages become Private
     * roots on restore: the space no longer exists to inherit from.
     */
    @Transactional
    public void deleteSpace(UUID userId, UUID spaceId, boolean deleteDocuments) {
        Space space =
                spaceRepository.findByIdForUpdate(spaceId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
        // Checked under the lock: a space member promoted while this transaction waited
        // must be able to administer the deletion it is holding the row for.
        spaceAccessService.requireAdministration(userId, spaceId);

        List<Document> rootPages = documentRepository.findAllBySpace_IdAndParentIsNullAndDeletedAtIsNull(space.getId());
        if (!rootPages.isEmpty() && !deleteDocuments) {
            throw new ApiException(
                    ErrorCode.CONFLICT,
                    "This space still holds pages. Move them out, or delete the space and its pages together.");
        }
        for (Document page : rootPages) {
            documentService.trashSubtree(page);
        }

        spaceRepository.delete(space);
        log.info(
                "Deleted space {} with {} root page(s), deleteDocuments={}",
                spaceId,
                rootPages.size(),
                deleteDocuments);
    }

    /** Member roster. Space member or workspace admin; link-only readers do not exist here. */
    @Transactional(readOnly = true)
    public List<SpaceMemberResponse> listMembers(UUID userId, UUID spaceId) {
        spaceAccessService.requireRead(userId, spaceId);
        return roster(spaceId);
    }

    /**
     * Adds an existing workspace member to the space. Adding somebody who is already
     * listed is a conflict: changing their level is an update, and silently demoting an
     * owner through an "add" would be a surprise.
     */
    @Transactional
    public List<SpaceMemberResponse> addMember(UUID userId, UUID spaceId, SpaceMemberCreateRequest request) {
        SpaceContext context = spaceAccessService.requireAdministration(userId, spaceId);
        DocumentAccessLevel level = normalizeMemberLevel(request.accessLevel());

        User target = userRepository
                .findByEmail(request.email().strip().toLowerCase(Locale.ROOT))
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "User not found for the provided email."));
        if (workspaceMemberRepository
                .findByWorkspaceIdAndUserId(context.space().getWorkspace().getId(), target.getId())
                .isEmpty()) {
            throw new ApiException(ErrorCode.NOT_FOUND, "That person is not a member of this workspace.");
        }
        if (memberRepository.existsBySpace_IdAndUser_Id(spaceId, target.getId())) {
            throw new ApiException(ErrorCode.CONFLICT, "That person is already a member of this space.");
        }

        User actor = userRepository
                .findById(userId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Acting user not found."));
        memberRepository.save(SpaceMember.builder()
                .space(context.space())
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
        spaceAccessService.requireAdministration(userId, spaceId);
        Space space =
                spaceRepository.findByIdForUpdate(spaceId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
        spaceAccessService.requireAdministration(userId, spaceId);

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
            // admin who is not a member has nothing to leave.
            spaceAccessService.requireRead(userId, spaceId);
        } else {
            spaceAccessService.requireAdministration(userId, spaceId);
        }

        Space space =
                spaceRepository.findByIdForUpdate(spaceId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
        if (!self) {
            spaceAccessService.requireAdministration(userId, spaceId);
        }

        SpaceMember target = requireMember(space, targetUserId);
        if (target.getAccessLevel() == DocumentAccessLevel.OWNER && ownerCount(spaceId) <= 1) {
            throw new ApiException(ErrorCode.CONFLICT, self ? LAST_OWNER_LEAVE_MESSAGE : LAST_OWNER_MESSAGE);
        }
        memberRepository.delete(target);
        return roster(spaceId);
    }

    /**
     * Files an existing root page into the space. The page rules and both permission
     * checks (space administration, page EDIT) live in {@link DocumentService#assignSpace}.
     */
    @Transactional
    public DocumentResponse attachPage(UUID userId, UUID spaceId, UUID documentId) {
        return documentService.assignSpace(userId, documentId, spaceId);
    }

    /** Detaches a page from its space; it returns to the owner's Private section. */
    @Transactional
    public void detachPage(UUID userId, UUID spaceId, UUID documentId) {
        documentService.clearSpace(userId, documentId, spaceId);
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
        return new SpaceResponse(
                space.getId(),
                space.getName(),
                toIconResponse(space),
                space.getAccessMode(),
                space.getEveryoneAccessLevel(),
                myAccessLevel,
                canAdminister,
                memberCount,
                pageCount,
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
