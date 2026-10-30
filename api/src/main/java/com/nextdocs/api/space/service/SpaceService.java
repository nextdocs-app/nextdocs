package com.nextdocs.api.space.service;

import com.nextdocs.api.attachment.AttachmentScope;
import com.nextdocs.api.attachment.dto.response.AttachmentResponse;
import com.nextdocs.api.attachment.service.AttachmentService;
import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.dto.response.DocumentResponse;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.service.DocumentService;
import com.nextdocs.api.document.util.FractionalIndex;
import com.nextdocs.api.pageicon.PageIconType;
import com.nextdocs.api.pageicon.dto.response.PageIconResponse;
import com.nextdocs.api.pageicon.validation.PageIconValidator;
import com.nextdocs.api.space.dto.request.SpaceCreateRequest;
import com.nextdocs.api.space.dto.request.SpaceMemberAccessUpdateRequest;
import com.nextdocs.api.space.dto.request.SpaceMemberCreateRequest;
import com.nextdocs.api.space.dto.request.SpaceMoveRequest;
import com.nextdocs.api.space.dto.request.SpaceUpdateRequest;
import com.nextdocs.api.space.dto.response.SpaceMemberResponse;
import com.nextdocs.api.space.dto.response.SpaceResponse;
import com.nextdocs.api.space.entity.Space;
import com.nextdocs.api.space.entity.SpaceAccessMode;
import com.nextdocs.api.space.entity.SpaceMember;
import com.nextdocs.api.space.entity.UserSpaceOrder;
import com.nextdocs.api.space.repository.SpaceMemberRepository;
import com.nextdocs.api.space.repository.SpaceRepository;
import com.nextdocs.api.space.repository.UserSpaceOrderRepository;
import com.nextdocs.api.space.service.SpaceAccessService.SpaceContext;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import com.nextdocs.api.workspace.repository.WorkspaceRepository;
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
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

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

    /** Order-key collisions are the only expected integrity failure; retry a bounded time. */
    private static final int MAX_ORDER_ATTEMPTS = 3;

    private static final int REINDEX_GAP = 8;

    /** Levels a member row may carry; NO_ACCESS has nothing above it to shadow. */
    private static final Set<DocumentAccessLevel> MEMBER_LEVELS = Set.of(
            DocumentAccessLevel.VIEW, DocumentAccessLevel.COMMENT, DocumentAccessLevel.EDIT, DocumentAccessLevel.OWNER);

    /** Levels the everyone-else grant may carry: ownership stays with members. */
    private static final Set<DocumentAccessLevel> EVERYONE_LEVELS =
            Set.of(DocumentAccessLevel.VIEW, DocumentAccessLevel.COMMENT, DocumentAccessLevel.EDIT);

    private final SpaceRepository spaceRepository;
    private final SpaceMemberRepository memberRepository;
    private final UserSpaceOrderRepository userSpaceOrderRepository;
    private final DocumentRepository documentRepository;
    private final WorkspaceAccessService workspaceAccessService;
    private final WorkspaceRepository workspaceRepository;
    private final WorkspaceMemberRepository workspaceMemberRepository;
    private final UserRepository userRepository;
    private final SpaceAccessService spaceAccessService;
    private final DocumentService documentService;
    private final PageIconValidator pageIconValidator;
    private final AttachmentService attachmentService;

    @Autowired
    @Lazy
    private SpaceService selfProxy;

    /**
     * Active spaces the caller can see, in the caller's personal order: their
     * memberships, every PUBLIC space of the workspace, and — for a workspace owner or
     * admin — all of them, with {@code myAccessLevel} null for the ones they are not part
     * of. Spaces without an order row keep their creation order after the ordered ones.
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
                    ? spaceRepository.findAllActiveForUser(workspace.getId(), userId)
                    : spaceRepository.findAllVisibleToUser(workspace.getId(), userId);
        }
        if (spaces.isEmpty()) {
            return List.of();
        }

        List<UUID> spaceIds = spaces.stream().map(Space::getId).toList();
        Map<UUID, Long> memberCounts = fetchMemberCounts(spaceIds);
        Map<UUID, Long> pageCounts = fetchPageCounts(spaceIds);
        Map<UUID, String> orderKeys = fetchOrderKeys(userId, spaceIds);

        List<SpaceResponse> responses = new ArrayList<>(spaces.size());
        for (Space space : spaces) {
            DocumentAccessLevel level = levels.get(space.getId());
            if (level == null && space.getAccessMode() == SpaceAccessMode.PUBLIC) {
                level = space.getEveryoneAccessLevel();
            }
            responses.add(toResponse(
                    space,
                    orderKeys.get(space.getId()),
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
        return toResponse(context, orderKey(userId, spaceId));
    }

    /**
     * Moves a space in the caller's personal sidebar order. Any caller who can read the
     * space may move it: the shared space row is untouched, only the caller's
     * {@code user_space_orders} position changes. Archived spaces are not navigable and
     * are therefore rejected.
     */
    public SpaceResponse moveSpace(UUID userId, UUID spaceId, SpaceMoveRequest request) {
        int attempt = 0;
        while (true) {
            try {
                return selfProxy != null
                        ? selfProxy.moveSpaceAndPersist(userId, spaceId, request, attempt > 0)
                        : moveSpaceAndPersist(userId, spaceId, request, attempt > 0);
            } catch (DataIntegrityViolationException ex) {
                log.warn(
                        "Concurrent space position change during move attempt={} userId={} spaceId={}",
                        attempt,
                        userId,
                        spaceId,
                        ex);
                attempt++;
                if (attempt >= MAX_ORDER_ATTEMPTS) {
                    throw new ApiException(ErrorCode.CONFLICT, "The position changed concurrently. Please retry.");
                }
            }
        }
    }

    /** Runs in its own transaction so a key collision can roll back and retry. */
    @Transactional
    public SpaceResponse moveSpaceAndPersist(
            UUID userId, UUID spaceId, SpaceMoveRequest request, boolean rebuildFirst) {
        WorkspaceAccessService.Membership membership = workspaceAccessService.requireMember(userId);
        SpaceContext context = spaceAccessService.requireRead(userId, spaceId);
        Space space = context.space();
        if (space.getArchivedAt() != null) {
            throw new ApiException(ErrorCode.CONFLICT, "This space is archived. Restore it before reordering.");
        }

        if (rebuildFirst) {
            reindexSpaceOrders(userId);
        }
        materializeSpaceOrders(userId, membership);

        String prevKey = resolveSpaceNeighborKey(userId, request.prevSiblingId(), spaceId);
        String nextKey = resolveSpaceNeighborKey(userId, request.nextSiblingId(), spaceId);

        if (prevKey != null && nextKey != null && prevKey.compareTo(nextKey) > 0) {
            String lower = prevKey;
            prevKey = nextKey;
            nextKey = lower;
        }

        if (prevKey != null && !FractionalIndex.isValidOrderKey(prevKey)
                || nextKey != null && !FractionalIndex.isValidOrderKey(nextKey)
                || prevKey != null && prevKey.equals(nextKey)) {
            reindexSpaceOrders(userId);
            materializeSpaceOrders(userId, membership);
            prevKey = resolveSpaceNeighborKey(userId, request.prevSiblingId(), spaceId);
            nextKey = resolveSpaceNeighborKey(userId, request.nextSiblingId(), spaceId);

            if (prevKey != null && nextKey != null && prevKey.compareTo(nextKey) > 0) {
                String lower = prevKey;
                prevKey = nextKey;
                nextKey = lower;
            }
        }

        String newOrderKey;
        try {
            if (prevKey != null) {
                // The requested neighbour is adjacent in the caller's active list, but
                // archived spaces share the same key space, so take the actual successor.
                String actualSuccessor = userSpaceOrderRepository
                        .findMinOrderKeyGreaterThan(userId, prevKey, spaceId)
                        .filter(FractionalIndex::isValidOrderKey)
                        .orElse(null);
                newOrderKey = FractionalIndex.keyBetween(prevKey, actualSuccessor);
            } else if (nextKey != null) {
                String actualPredecessor = userSpaceOrderRepository
                        .findMaxOrderKeyLessThan(userId, nextKey, spaceId)
                        .filter(FractionalIndex::isValidOrderKey)
                        .orElse(null);
                newOrderKey = FractionalIndex.keyBetween(actualPredecessor, nextKey);
            } else {
                String maxKey = userSpaceOrderRepository
                        .findMaxOrderKeyByUserId(userId, spaceId)
                        .filter(FractionalIndex::isValidOrderKey)
                        .orElse(null);
                newOrderKey = FractionalIndex.keyBetween(maxKey, null);
            }
        } catch (IllegalArgumentException ex) {
            log.warn("Invalid space order key interval: prevKey={} nextKey={}", prevKey, nextKey, ex);
            throw new ApiException(ErrorCode.CONFLICT, "The position changed concurrently. Please retry.");
        }

        UserSpaceOrder order = userSpaceOrderRepository
                .findByUser_IdAndSpace_Id(userId, spaceId)
                .orElseGet(() -> {
                    User user =
                            userRepository.findById(userId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
                    return UserSpaceOrder.builder().user(user).space(space).build();
                });
        order.setOrderKey(newOrderKey);
        userSpaceOrderRepository.saveAndFlush(order);

        return toResponse(
                space,
                newOrderKey,
                context.accessLevel(),
                context.canAdminister(),
                memberRepository.countBySpace_Id(spaceId),
                documentRepository.countBySpace_Id(spaceId));
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
                orderKey(userId, spaceId),
                spaceAccessService.resolveLevel(userId, space),
                lockedContext.canAdminister(),
                memberRepository.countBySpace_Id(spaceId),
                documentRepository.countBySpace_Id(spaceId));
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
                orderKey(userId, spaceId),
                spaceAccessService.resolveLevel(userId, space),
                lockedContext.canAdminister(),
                memberRepository.countBySpace_Id(spaceId),
                documentRepository.countBySpace_Id(spaceId));
    }

    /**
     * Creates the space and makes the caller its first owner. The caller must be a
     * workspace member (already guaranteed by the access service). A new space goes to
     * the top of the creator's sidebar, matching a newly created root page.
     */
    public SpaceResponse createSpace(UUID userId, SpaceCreateRequest request) {
        int attempt = 0;
        while (true) {
            try {
                return selfProxy != null ? selfProxy.insertSpace(userId, request) : insertSpace(userId, request);
            } catch (DataIntegrityViolationException ex) {
                log.warn("Concurrent space order collision during create attempt={} userId={}", attempt, userId, ex);
                attempt++;
                if (attempt >= MAX_ORDER_ATTEMPTS) {
                    throw new ApiException(ErrorCode.CONFLICT, "Could not assign a space position. Please retry.");
                }
            }
        }
    }

    @Transactional
    public SpaceResponse insertSpace(UUID userId, SpaceCreateRequest request) {
        WorkspaceAccessService.Membership membership = workspaceAccessService.requireMember(userId);
        Workspace workspace = membership.workspace();
        User creator = membership.member().getUser();

        String name = normalizeName(request.name());
        AttachmentScope iconScope = AttachmentScope.workspace(workspace.getId());
        PageIconValidator.ValidatedIcon icon =
                request.icon() == null ? null : pageIconValidator.validateSpaceIcon(request.icon(), iconScope);
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
        if (icon != null) {
            // The sweep and the workspace icon update read icon references under the
            // workspace row lock; take the same lock so this adoption cannot commit
            // between their snapshot and the file delete. Validation ran before the
            // lock, so re-read the upload under it.
            lockWorkspace(workspace.getId());
            revalidateUploadIcon(icon, iconScope);
        }
        applyIcon(space, icon);
        // Flush so @CreationTimestamp fills createdAt/updatedAt before the response:
        // the client sorts spaces by createdAt and requires it on create.
        Space saved = spaceRepository.saveAndFlush(space);

        memberRepository.save(SpaceMember.builder()
                .space(saved)
                .user(creator)
                .accessLevel(DocumentAccessLevel.OWNER)
                .build());

        String orderKey = initialSpaceOrderKey(userId);
        userSpaceOrderRepository.saveAndFlush(UserSpaceOrder.builder()
                .user(creator)
                .space(saved)
                .orderKey(orderKey)
                .build());

        log.info("Created space {} in workspace {} owned by {}", saved.getId(), workspace.getId(), userId);
        return toResponse(saved, orderKey, DocumentAccessLevel.OWNER, true, 1L, 0L);
    }

    /** Renames, re-shares, or re-icons a space. Space owner or workspace admin. */
    @Transactional
    public SpaceResponse updateSpace(UUID userId, UUID spaceId, SpaceUpdateRequest request) {
        SpaceContext context = spaceAccessService.requireActiveAdministration(userId, spaceId);
        UUID workspaceId = context.space().getWorkspace().getId();

        // Validate icon bytes and level values before taking the row lock: storage I/O
        // and pure validation must not serialize every membership change behind them.
        AttachmentScope iconScope = AttachmentScope.workspace(workspaceId);
        PageIconValidator.ValidatedIcon icon =
                request.icon() == null ? null : pageIconValidator.validateSpaceIcon(request.icon(), iconScope);
        DocumentAccessLevel everyoneLevel =
                request.everyoneAccessLevel() == null ? null : normalizeEveryoneLevel(request.everyoneAccessLevel());
        String name = request.name() == null ? null : normalizeName(request.name());

        // Take the workspace lock before the space row: adopting or releasing an upload
        // must serialize with the sweep and the workspace icon update, which read icon
        // references while holding that lock. Every path locks them in this order.
        if (icon != null) {
            lockWorkspace(workspaceId);
        }
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
            // Validation ran before the lock: re-read so an upload the sweep already deleted
            // by the time this transaction got here is refused instead of adopted.
            revalidateUploadIcon(icon, iconScope);
            applyIcon(space, icon);
        }
        Space saved = spaceRepository.save(space);
        return toResponse(
                saved,
                orderKey(userId, spaceId),
                spaceAccessService.resolveLevel(userId, saved),
                lockedContext.canAdminister(),
                memberRepository.countBySpace_Id(spaceId),
                documentRepository.countBySpace_Id(spaceId));
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

        // The production FK is ON DELETE CASCADE, but tests create the schema from the
        // entities, where no cascade is declared. Delete the personal rows explicitly,
        // before the space row, so the flush inside the delete query cannot hit the FK.
        userSpaceOrderRepository.deleteBySpace_Id(spaceId);
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

    /**
     * Row-locks the workspace around an icon reference change. The abandoned-upload sweep
     * and the workspace icon update take this lock before consulting space icon references,
     * so holding it here keeps an adopted upload from being swept or a released one from
     * being adopted concurrently.
     */
    private void lockWorkspace(UUID workspaceId) {
        workspaceRepository.findByIdForUpdate(workspaceId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
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

    private SpaceResponse toResponse(SpaceContext context, String orderKey) {
        Space space = context.space();
        return toResponse(
                space,
                orderKey,
                context.accessLevel(),
                context.canAdminister(),
                memberRepository.countBySpace_Id(space.getId()),
                documentRepository.countBySpace_Id(space.getId()));
    }

    private String orderKey(UUID userId, UUID spaceId) {
        return userSpaceOrderRepository
                .findOrderKeyByUserIdAndSpaceId(userId, spaceId)
                .filter(FractionalIndex::isValidOrderKey)
                .orElse(null);
    }

    private Map<UUID, String> fetchOrderKeys(UUID userId, List<UUID> spaceIds) {
        Map<UUID, String> keys = new HashMap<>();
        for (Object[] row : userSpaceOrderRepository.findOrderKeysByUserIdAndSpaceIds(userId, spaceIds)) {
            String key = (String) row[1];
            // An unparseable key is treated as no key: listings fall back to creation
            // order, and a move rebuilds the row instead of chaining off garbage.
            if (FractionalIndex.isValidOrderKey(key)) {
                keys.put((UUID) row[0], key);
            }
        }
        return keys;
    }

    /**
     * Key for a space created now: before every other space of the caller. This mirrors
     * root-page creation, where a new page also lands at the top of the personal order.
     */
    private String initialSpaceOrderKey(UUID userId) {
        String minKey = userSpaceOrderRepository
                .findMinOrderKeyByUserId(userId)
                .filter(FractionalIndex::isValidOrderKey)
                .orElse(null);
        return FractionalIndex.keyBetween(null, minKey);
    }

    /**
     * Gives every visible active space a personal key before a move. Spaces without a
     * row currently sort by creation time after the keyed ones, so walking the displayed
     * order and appending each missing key preserves exactly what the caller sees.
     *
     * <p>Only the moved space and its requested neighbours strictly need a row, but
     * materialising the whole list keeps later moves stable and guarantees a neighbour
     * always has a key to compute against.
     */
    private void materializeSpaceOrders(UUID userId, WorkspaceAccessService.Membership membership) {
        Workspace workspace = membership.workspace();
        List<Space> visible = membership.member().getRole().canManageMembers()
                ? spaceRepository.findAllActiveForUser(workspace.getId(), userId)
                : spaceRepository.findAllVisibleToUser(workspace.getId(), userId);
        if (visible.isEmpty()) {
            return;
        }
        Map<UUID, String> keys =
                fetchOrderKeys(userId, visible.stream().map(Space::getId).toList());
        User user = null;
        String previousKey = null;
        for (Space space : visible) {
            String key = keys.get(space.getId());
            if (key == null) {
                if (user == null) {
                    user = userRepository.findById(userId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
                }
                key = nextFreeSpaceOrderKey(userId, previousKey);
                userSpaceOrderRepository.save(UserSpaceOrder.builder()
                        .user(user)
                        .space(space)
                        .orderKey(key)
                        .build());
            }
            previousKey = key;
        }
        userSpaceOrderRepository.flush();
    }

    private String nextFreeSpaceOrderKey(UUID userId, String previousKey) {
        String candidate = FractionalIndex.keyBetween(previousKey, null);
        while (userSpaceOrderRepository.existsByUser_IdAndOrderKey(userId, candidate)) {
            candidate = FractionalIndex.keyBetween(candidate, null);
        }
        return candidate;
    }

    private void reindexSpaceOrders(UUID userId) {
        List<UserSpaceOrder> orders = userSpaceOrderRepository.findAllForReindex(userId);
        if (orders.isEmpty()) {
            return;
        }
        // Park every row on a temporary key first: a row's final key can equal a
        // neighbour's current key, and uq_user_space_orders_user_order_key rejects that
        // transient state whatever order the flush happens to write rows in.
        for (int i = 0; i < orders.size(); i++) {
            orders.get(i).setOrderKey("~reindex-" + i);
        }
        userSpaceOrderRepository.flush();

        String[] newKeys = FractionalIndex.nKeysBetweenSpaced(null, null, orders.size(), REINDEX_GAP);
        for (int i = 0; i < orders.size(); i++) {
            orders.get(i).setOrderKey(newKeys[i]);
        }
        userSpaceOrderRepository.flush();
    }

    private String resolveSpaceNeighborKey(UUID userId, UUID siblingId, UUID excludedSpaceId) {
        if (siblingId == null) {
            return null;
        }
        if (siblingId.equals(excludedSpaceId)) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "A space cannot be its own sibling reference.");
        }
        SpaceContext sibling = spaceAccessService.requireRead(userId, siblingId);
        if (sibling.space().getArchivedAt() != null) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "An archived space cannot be a navigation sibling.");
        }
        return userSpaceOrderRepository
                .findOrderKeyByUserIdAndSpaceId(userId, siblingId)
                .filter(FractionalIndex::isValidOrderKey)
                .orElse(null);
    }

    private static SpaceResponse toResponse(
            Space space,
            String orderKey,
            DocumentAccessLevel myAccessLevel,
            boolean canAdminister,
            long memberCount,
            long pageCount) {
        // An archived space caps content at VIEW; reporting the pre-archive membership
        // level as "effective" would advertise a write grant the page endpoints deny.
        // canAdminister stays the restore flag.
        DocumentAccessLevel effectiveLevel =
                myAccessLevel != null && space.getArchivedAt() != null ? DocumentAccessLevel.VIEW : myAccessLevel;
        return new SpaceResponse(
                space.getId(),
                space.getName(),
                orderKey,
                PageIconResponse.from(space.getIconType(), space.getIconValue(), space.getIconColor()),
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
        for (Object[] row : documentRepository.countBySpaceIds(spaceIds)) {
            counts.put((UUID) row[0], ((Number) row[1]).longValue());
        }
        return counts;
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
     * Stores an image a space icon can reference. Any workspace member may upload: opening
     * a space is open to members, and an upload no icon adopts stays private and is swept,
     * so a file only becomes an icon through create or update. Set the returned id with
     * icon type {@code UPLOAD}.
     */
    public AttachmentResponse uploadIconAttachment(UUID userId, MultipartFile file) {
        WorkspaceAccessService.Membership membership = workspaceAccessService.requireMember(userId);
        return attachmentService.uploadSpaceIconAttachment(
                userId, membership.workspace().getId(), file);
    }

    /**
     * Applies an already-validated icon: a value with a null type clears it. Uploads
     * reference a workspace-scoped attachment, and replacing or clearing one reclaims the
     * file and its quota unless another icon still renders that same upload.
     */
    private void applyIcon(Space space, PageIconValidator.ValidatedIcon icon) {
        if (icon == null) {
            return;
        }
        if (icon.type() == null) {
            releaseReplacedIconUpload(space, null);
            space.setIconType(null);
            space.setIconValue(null);
            space.setIconColor(null);
            return;
        }
        releaseReplacedIconUpload(space, icon.type() == PageIconType.UPLOAD ? icon.value() : null);
        space.setIconType(icon.type());
        space.setIconValue(icon.value());
        space.setIconColor(icon.color());
    }

    /**
     * Deletes the file behind the current upload icon unless {@code keepValue} is that
     * same id. The stored value is always one this class wrote through
     * {@link PageIconValidator#validateUpload}, so it parses as a UUID.
     */
    private void releaseReplacedIconUpload(Space space, String keepValue) {
        if (space.getIconType() != PageIconType.UPLOAD) {
            return;
        }
        String currentValue = space.getIconValue();
        if (currentValue == null || currentValue.equals(keepValue)) {
            return;
        }
        Workspace workspace = space.getWorkspace();
        if (isUploadStillReferenced(workspace, currentValue, space.getId())) {
            return;
        }
        attachmentService.deleteWorkspaceUpload(workspace.getId(), UUID.fromString(currentValue));
    }

    /**
     * The workspace icon and every space share one upload bucket, and a client can point
     * two icons at the same upload. Reclaiming a file another icon still renders would
     * break that icon, so the sweep and this check both skip referenced uploads.
     */
    private boolean isUploadStillReferenced(Workspace workspace, String value, UUID exceptSpaceId) {
        if (workspace.getIconType() == PageIconType.UPLOAD && value.equals(workspace.getIconValue())) {
            return true;
        }
        return spaceRepository.existsByWorkspace_IdAndIconTypeAndIconValueAndIdNot(
                workspace.getId(), PageIconType.UPLOAD, value, exceptSpaceId);
    }

    /** An adopted upload must still exist, still be raster, and still belong to the workspace. */
    private void revalidateUploadIcon(PageIconValidator.ValidatedIcon icon, AttachmentScope scope) {
        if (icon != null && icon.type() == PageIconType.UPLOAD) {
            pageIconValidator.validateUploadReference("Icon", icon.value(), scope);
        }
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
