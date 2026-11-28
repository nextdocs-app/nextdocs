package com.nextdocs.api.document.service;

import com.nextdocs.api.audit.entity.AccessAuditAction;
import com.nextdocs.api.audit.service.AccessAuditService;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.dto.request.CollaboratorAccessUpdateRequest;
import com.nextdocs.api.document.dto.request.CollaboratorUpsertRequest;
import com.nextdocs.api.document.dto.response.CollaboratorResponse;
import com.nextdocs.api.document.dto.response.DocumentAccessResponse;
import com.nextdocs.api.document.dto.response.DocumentSpaceResponse;
import com.nextdocs.api.document.entity.AccessGrant;
import com.nextdocs.api.document.entity.AccessGrantEffect;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.repository.AccessGrantRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.repository.UserSharedOrderRepository;
import com.nextdocs.api.document.util.OrderPositionConflict;
import com.nextdocs.api.realtime.event.DocumentAccessChangedEvent;
import com.nextdocs.api.space.entity.Space;
import com.nextdocs.api.space.entity.SpaceAccessMode;
import com.nextdocs.api.space.entity.SpaceMember;
import com.nextdocs.api.space.repository.SpaceMemberRepository;
import com.nextdocs.api.space.service.SpaceAccessService;
import com.nextdocs.api.space.service.SpaceAccessService.SpaceContext;
import com.nextdocs.api.user.entity.User;
import com.nextdocs.api.user.repository.UserRepository;
import com.nextdocs.api.workspace.repository.WorkspaceRepository;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.Lazy;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class DocumentSharingService {

    private static final int MAX_ORDER_UPSERT_ATTEMPTS = 3;

    private static final String LAST_OWNER_MESSAGE = "The page must keep at least one owner.";

    private static final String LAST_OWNER_LEAVE_MESSAGE =
            "Make another person a full-access collaborator before leaving this page.";

    private final DocumentRepository documentRepository;
    private final AccessGrantRepository accessGrantRepository;
    private final UserSharedOrderRepository userSharedOrderRepository;
    private final SharedSectionService sharedSectionService;
    private final UserRepository userRepository;
    private final PermissionService permissionService;
    private final SpaceAccessService spaceAccessService;
    private final SpaceMemberRepository spaceMemberRepository;
    private final DocumentOwnershipService ownershipService;
    private final AccessGrantSyncService accessGrantSyncService;
    private final AccessAuditService auditService;
    private final ApplicationEventPublisher eventPublisher;
    private final WorkspaceRepository workspaceRepository;

    @Autowired
    @Lazy
    private DocumentSharingService selfProxy;

    @Transactional(readOnly = true)
    public List<CollaboratorResponse> listCollaborators(UUID requesterId, UUID documentId) {
        Document doc = permissionService.requireReadAccessIncludingTrash(requesterId, documentId);
        permissionService.requireRosterAccess(requesterId, doc);

        Set<UUID> directUserIds = new HashSet<>();
        List<CollaboratorResponse> result = new ArrayList<>();

        Space space = permissionService.resolveSpace(doc);

        // 1. Direct page grants from the canonical store. Every person on the page is
        // one of these, the creator included: ownership is a level, not a row identity.
        List<AccessGrant> directGrants = accessGrantRepository.findUserGrantsByDocumentId(documentId);
        for (AccessGrant grant : directGrants) {
            directUserIds.add(grant.getUser().getId());
        }

        // 2. Inherited user grants from ancestors
        var ancestorContext = ownershipService.loadAncestorContext(doc);
        Map<UUID, AncestorGrantInfo> directAncestorGrants = new HashMap<>();
        Set<UUID> handledDirectUserIds = new HashSet<>();
        Set<UUID> handledAncestorUserIds = new HashSet<>();
        List<CollaboratorResponse> inheritedResponses = new ArrayList<>();

        // Title masking needs the requester's access per ancestor: one batch
        // query for the whole chain instead of one recursive CTE per level.
        Map<UUID, DocumentAccessLevel> ancestorAccessById = permissionService.resolveIdentityAccessBatch(
                requesterId,
                ancestorContext.ancestors().stream().map(Document::getId).toList());

        for (Document ancestor : ancestorContext.ancestors()) {
            boolean visible = ancestorAccessById.get(ancestor.getId()) != null;
            String ancestorTitle = visible ? SharingDocuments.titleOrUntitled(ancestor) : null;

            // Ancestor user grants. The first row for a person wins, so a nearer
            // NO_ACCESS breakpoint blocks farther positive rows.
            for (AccessGrant grant : ancestorContext.grantsByDocument().getOrDefault(ancestor.getId(), List.of())) {
                UUID uid = grant.getUser().getId();
                DocumentAccessLevel level = levelOf(grant);
                if (directUserIds.contains(uid)) {
                    if (handledDirectUserIds.add(uid) && level != DocumentAccessLevel.NO_ACCESS && visible) {
                        directAncestorGrants.put(uid, new AncestorGrantInfo(ancestor.getId(), ancestorTitle, level));
                    }
                } else if (handledAncestorUserIds.add(uid) && level != DocumentAccessLevel.NO_ACCESS && visible) {
                    inheritedResponses.add(new CollaboratorResponse(
                            grant.getUser().getId(),
                            grant.getUser().getEmail(),
                            grant.getUser().getDisplayName(),
                            grant.getUser().getAvatarUrl(),
                            level,
                            grant.getCreatedAt(),
                            true,
                            ancestor.getId(),
                            ancestorTitle,
                            null));
                }
            }
        }

        // 4. Space container as the root of the hierarchy
        if (space != null && canViewSpaceRoster(requesterId, space)) {
            String spaceTitle = space.getName();
            List<SpaceMember> spaceMembers = spaceMemberRepository.findAllBySpace_IdOrderByCreatedAtAsc(space.getId());
            // Provenance reflects the stored grant origin on the SpaceMember row, not the
            // resolver output: the roster describes configured grants, while the viewer's
            // own access summary names the independent sources that actually resolve.
            for (SpaceMember sm : spaceMembers) {
                UUID uid = sm.getUser().getId();
                if (directUserIds.contains(uid)) {
                    if (handledDirectUserIds.add(uid)) {
                        directAncestorGrants.put(
                                uid, new AncestorGrantInfo(space.getId(), spaceTitle, sm.getAccessLevel()));
                    }
                } else if (handledAncestorUserIds.add(uid)) {
                    inheritedResponses.add(new CollaboratorResponse(
                            sm.getUser().getId(),
                            sm.getUser().getEmail(),
                            sm.getUser().getDisplayName(),
                            sm.getUser().getAvatarUrl(),
                            sm.getAccessLevel(),
                            sm.getCreatedAt(),
                            true,
                            space.getId(),
                            spaceTitle,
                            null));
                }
            }

            if (space.getAccessMode() == SpaceAccessMode.PUBLIC) {
                for (UUID uid : directUserIds) {
                    if (handledDirectUserIds.add(uid)) {
                        directAncestorGrants.put(
                                uid,
                                new AncestorGrantInfo(space.getId(), spaceTitle, space.getEveryoneAccessLevel(), true));
                    }
                }
            }
        }

        for (AccessGrant grant : directGrants) {
            UUID uid = grant.getUser().getId();
            DocumentAccessLevel directLevel = levelOf(grant);
            AncestorGrantInfo grantInfo = directAncestorGrants.get(uid);
            // Everyone-access is not a per-person grant, so a direct row never overrides
            // it (nothing was granted to that person to begin with). Only a block names
            // it, because a block is what actually removes access the page would carry.
            if (grantInfo != null && grantInfo.everyoneAccess() && directLevel != DocumentAccessLevel.NO_ACCESS) {
                grantInfo = null;
            }
            result.add(new CollaboratorResponse(
                    uid,
                    grant.getUser().getEmail(),
                    grant.getUser().getDisplayName(),
                    grant.getUser().getAvatarUrl(),
                    directLevel,
                    grant.getCreatedAt(),
                    false,
                    grantInfo != null ? grantInfo.docId() : null,
                    grantInfo != null ? grantInfo.title() : null,
                    grantInfo != null ? grantInfo.level() : null));
        }

        result.addAll(inheritedResponses);
        return result;
    }

    @Transactional(readOnly = true)
    public boolean hasHiddenSharingSources(UUID requesterId, UUID documentId) {
        Document doc = permissionService.requireReadAccessIncludingTrash(requesterId, documentId);
        permissionService.requireRosterAccess(requesterId, doc);
        var ancestors = ownershipService.loadAncestorContext(doc).ancestors();
        Map<UUID, DocumentAccessLevel> access = permissionService.resolveIdentityAccessBatch(
                requesterId, ancestors.stream().map(Document::getId).toList());
        if (ancestors.stream().anyMatch(ancestor -> access.get(ancestor.getId()) == null)) {
            return true;
        }
        Space space = permissionService.resolveSpace(doc);
        return space != null && !canViewSpaceRoster(requesterId, space);
    }

    public CollaboratorResponse upsertCollaborator(UUID actorId, UUID documentId, CollaboratorUpsertRequest request) {
        int attempt = 0;
        while (true) {
            try {
                return selfProxy != null
                        ? selfProxy.upsertCollaboratorAndPersist(actorId, documentId, request)
                        : upsertCollaboratorAndPersist(actorId, documentId, request);
            } catch (DataIntegrityViolationException ex) {
                if (!OrderPositionConflict.isRetryable(ex)) {
                    throw ex;
                }
                attempt++;
                if (attempt >= MAX_ORDER_UPSERT_ATTEMPTS) {
                    throw ex;
                }
            }
        }
    }

    /**
     * Adds or updates a collaborator on a document.
     */
    @Transactional
    public CollaboratorResponse upsertCollaboratorAndPersist(
            UUID actorId, UUID documentId, CollaboratorUpsertRequest request) {
        lockForOwnershipChange(documentId);
        Document doc = permissionService.requireSharingAdminAccess(actorId, documentId);
        DocumentAccessLevel requestedLevel = normalizeCollaboratorAccess(request.accessLevel());
        if (requestedLevel == DocumentAccessLevel.NO_ACCESS) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "NO_ACCESS is not allowed for collaborator invites.");
        }

        User targetUser = userRepository
                .findByEmail(request.email().strip().toLowerCase())
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "User not found for the provided email."));

        if (targetUser.getId().equals(actorId)) {
            throw new ApiException(ErrorCode.CONFLICT, "Cannot modify own collaborator access.");
        }

        Space space = permissionService.resolveSpace(doc);
        if (space == null
                && requestedLevel != DocumentAccessLevel.OWNER
                && currentLevel(doc, targetUser.getId()) == DocumentAccessLevel.OWNER) {
            ownershipService.requireAnotherOwner(doc, targetUser.getId(), LAST_OWNER_MESSAGE);
        }

        User actor = resolveActor(actorId, doc);

        // Any inherited grant - including an ancestor's OWNER grant - can be
        // replaced with a positive level on this document; a direct grant always wins
        // over the ancestor walk. No access is the exception: an inherited owner
        // cannot be cut off from below (see updateCollaboratorAccess).
        AccessGrant saved = accessGrantSyncService.upsertUserGrant(doc, targetUser, requestedLevel, actor);
        auditService.recordDocument(
                doc,
                actorId,
                AccessAuditAction.COLLABORATOR_UPSERT,
                "USER",
                targetUser.getId(),
                "level=" + requestedLevel);

        // Ensure the new holder has a Shared-section order row so root documents and
        // floated nested documents can be reordered. The actor gets one too when the
        // page was private to them and this grant is what moves it to Shared.
        ensureSharedOrderRow(doc, targetUser);
        // The actor cannot be the target: inviting yourself is rejected above.
        if (doc.getParent() == null && doc.getSpace() == null) {
            ensureSharedOrderRow(doc, actor);
        }
        eventPublisher.publishEvent(new DocumentAccessChangedEvent(documentId, List.of(targetUser.getId())));

        return new CollaboratorResponse(
                saved.getUser().getId(),
                saved.getUser().getEmail(),
                saved.getUser().getDisplayName(),
                saved.getUser().getAvatarUrl(),
                levelOf(saved),
                saved.getCreatedAt());
    }

    /**
     * Changes a collaborator's level, including your own. Ownership is a level here, not a
     * privilege of the creator row: the creator is editable by any sharing admin (and by
     * themselves) exactly like another owner. Mirrors spaces, where an
     * owner may step down while another owner remains.
     *
     * <p>Removing yourself stays on {@link #leaveSharedDocument}: a self NO_ACCESS row would
     * be a breakpoint only an admin could undo, so it is refused here.
     *
     * <p>A No access row is also refused for someone who owns the scope they inherit from
     * (their space, or an ancestor page). A private page is outside the workspace/space
     * hierarchy, so the workspace role alone is not protected there. A page admin may edit
     * levels, but ownership of the level above is not theirs to override.
     */
    @Transactional
    public void updateCollaboratorAccess(
            UUID actorId, UUID documentId, UUID collaboratorUserId, CollaboratorAccessUpdateRequest request) {
        lockForOwnershipChange(documentId);
        Document doc = permissionService.requireSharingAdminAccess(actorId, documentId);

        DocumentAccessLevel requestedLevel = normalizeCollaboratorAccess(request.accessLevel());
        if (actorId.equals(collaboratorUserId) && requestedLevel == DocumentAccessLevel.NO_ACCESS) {
            throw new ApiException(ErrorCode.CONFLICT, "You cannot block yourself. Leave the page instead.");
        }
        User actor = resolveActor(actorId, doc);

        Space space = permissionService.resolveSpace(doc);

        if (requestedLevel == DocumentAccessLevel.NO_ACCESS) {
            String ownerBlock = ownershipService.inheritedOwnerBlockMessage(doc, collaboratorUserId);
            if (ownerBlock != null) {
                throw new ApiException(ErrorCode.CONFLICT, ownerBlock);
            }
        }

        if (space == null
                && requestedLevel != DocumentAccessLevel.OWNER
                && currentLevel(doc, collaboratorUserId) == DocumentAccessLevel.OWNER) {
            ownershipService.requireAnotherOwner(doc, collaboratorUserId, LAST_OWNER_MESSAGE);
        }

        boolean hasIdentityGrant = accessGrantRepository.hasPositiveIdentityGrant(collaboratorUserId, documentId);
        Optional<AccessGrant> grantOpt =
                accessGrantRepository.findByDocument_IdAndUser_Id(documentId, collaboratorUserId);

        if (grantOpt.isEmpty() && !hasIdentityGrant) {
            throw new ApiException(ErrorCode.NOT_FOUND, "Collaborator not found.");
        }

        User targetUser = grantOpt.map(AccessGrant::getUser)
                .orElseGet(() -> userRepository
                        .findById(collaboratorUserId)
                        .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Collaborator user not found.")));

        if (requestedLevel == DocumentAccessLevel.NO_ACCESS) {
            // A breakpoint shadows identity-channel grants only. It is stored only when
            // something positive exists to shadow; otherwise the direct grant is removed.
            if (!hasIdentityGrant) {
                accessGrantRepository.deleteByDocument_IdAndUser_Id(documentId, collaboratorUserId);
                userSharedOrderRepository.deleteByUser_IdAndDocument_Id(collaboratorUserId, documentId);
            } else {
                accessGrantSyncService.upsertUserGrant(doc, targetUser, DocumentAccessLevel.NO_ACCESS, actor);
                userSharedOrderRepository.deleteByUser_IdAndDocument_Id(collaboratorUserId, documentId);
            }
        } else {
            accessGrantSyncService.upsertUserGrant(doc, targetUser, requestedLevel, actor);
            ensureSharedOrderRow(doc, targetUser);
        }

        auditService.recordDocument(
                doc,
                actorId,
                AccessAuditAction.COLLABORATOR_UPDATE,
                "USER",
                collaboratorUserId,
                "level=" + requestedLevel);
        reconcileSharedRoots(collaboratorUserId, documentId);
        if (requestedLevel == DocumentAccessLevel.NO_ACCESS) {
            accessGrantRepository.pruneOrphanedBreakpoints(documentId);
        }
        eventPublisher.publishEvent(new DocumentAccessChangedEvent(documentId, List.of(collaboratorUserId)));
    }

    @Transactional
    public void removeCollaborator(UUID actorId, UUID documentId, UUID collaboratorUserId) {
        lockForOwnershipChange(documentId);
        Document doc = permissionService.requireSharingAdminAccess(actorId, documentId);

        if (actorId.equals(collaboratorUserId)) {
            throw new ApiException(ErrorCode.CONFLICT, "Cannot remove yourself as collaborator. Use leave instead.");
        }

        Space space = permissionService.resolveSpace(doc);
        if (space == null && currentLevel(doc, collaboratorUserId) == DocumentAccessLevel.OWNER) {
            ownershipService.requireAnotherOwner(doc, collaboratorUserId, LAST_OWNER_MESSAGE);
        }

        boolean exists = accessGrantRepository.existsByDocument_IdAndUser_Id(documentId, collaboratorUserId);
        if (!exists) {
            throw new ApiException(
                    ErrorCode.NOT_FOUND,
                    "Collaborator not found. Inherited access is managed with a NO_ACCESS override.");
        }

        accessGrantRepository.deleteByDocument_IdAndUser_Id(documentId, collaboratorUserId);
        userSharedOrderRepository.deleteByUser_IdAndDocument_Id(collaboratorUserId, documentId);
        auditService.recordDocument(
                doc, actorId, AccessAuditAction.COLLABORATOR_REMOVE, "USER", collaboratorUserId, null);

        reconcileSharedRoots(collaboratorUserId, documentId);
        accessGrantRepository.pruneOrphanedBreakpoints(documentId);
        eventPublisher.publishEvent(new DocumentAccessChangedEvent(documentId, List.of(collaboratorUserId)));
    }

    @Transactional
    public void leaveSharedDocument(UUID userId, UUID documentId) {
        Document doc = permissionService.requireReadAccessIncludingTrash(userId, documentId);
        permissionService.requireActiveSpace(doc);
        lockForOwnershipChange(documentId);

        Space space = permissionService.resolveSpace(doc);
        Optional<AccessGrant> grant = accessGrantRepository.findByDocument_IdAndUser_Id(documentId, userId);
        if (grant.isEmpty()) {
            throw new ApiException(
                    ErrorCode.NOT_FOUND,
                    "Collaborator not found. Inherited access cannot be left; ask an admin for a NO_ACCESS override.");
        }
        if (grant.get().getEffect() != AccessGrantEffect.ALLOW) {
            throw new ApiException(ErrorCode.CONFLICT, "A page-level No access rule can only be removed by an admin.");
        }
        if (space == null && currentLevel(doc, userId) == DocumentAccessLevel.OWNER) {
            ownershipService.requireAnotherOwner(doc, userId, LAST_OWNER_LEAVE_MESSAGE);
        }

        accessGrantRepository.deleteByDocument_IdAndUser_Id(documentId, userId);
        userSharedOrderRepository.deleteByUser_IdAndDocument_Id(userId, documentId);
        auditService.recordDocument(doc, userId, AccessAuditAction.COLLABORATOR_LEAVE, "USER", userId, null);

        // Leaving may orphan NO_ACCESS breakpoints deeper in the subtree; if this user is
        // later re-granted access on an ancestor those stale rows would spring back to life.
        reconcileSharedRoots(userId, documentId);
        accessGrantRepository.pruneOrphanedBreakpoints(documentId);
        eventPublisher.publishEvent(new DocumentAccessChangedEvent(documentId, List.of(userId)));
    }

    @Transactional(readOnly = true)
    public DocumentAccessResponse getMyAccess(UUID userId, UUID documentId) {
        Document active =
                documentRepository.findByIdAndDeletedAtIsNull(documentId).orElse(null);
        if (active != null) {
            return computeActiveAccess(userId, documentId, active, true);
        }

        // Trashed documents: report the caller's pre-trash access so the UI can offer a
        // read-only trash view (any level) versus manage actions (EDIT and above).
        // `owner` mirrors the active path: the resolved level is OWNER.
        DocumentAccessLevel trashAccess = permissionService.resolveTrashAccess(userId, documentId);
        if (trashAccess == null) {
            return new DocumentAccessResponse(documentId, false, null, false, true, false, null);
        }
        Document trashed = documentRepository.findById(documentId).orElse(null);
        Space space = trashed != null ? permissionService.resolveSpace(trashed) : null;
        boolean owner = trashAccess == DocumentAccessLevel.OWNER;
        SharingContext sharing =
                trashed != null ? resolveSharingContext(userId, trashed, trashAccess) : SharingContext.NONE;
        return new DocumentAccessResponse(
                documentId, true, trashAccess, owner, true, sharing.canManageSharing(), sharing.space());
    }

    @Transactional(readOnly = true)
    public DocumentAccessResponse accessCheck(UUID userId, UUID documentId) {
        return computeAccess(userId, documentId);
    }

    @Transactional(readOnly = true)
    public DocumentAccessResponse accessCheckPublic(UUID documentId) {
        Document doc = documentRepository.findByIdAndDeletedAtIsNull(documentId).orElse(null);
        if (doc == null) {
            return new DocumentAccessResponse(documentId, false, null, false, false);
        }
        DocumentAccessLevel level = permissionService.resolvePublicAccess(documentId);
        if (level == null) {
            return new DocumentAccessResponse(documentId, false, null, false, false);
        }
        return new DocumentAccessResponse(documentId, true, level, false, false);
    }

    private void ensureSharedOrderRow(Document doc, User targetUser) {
        sharedSectionService.ensureOrderRow(targetUser, doc);
    }

    /**
     * Serializes an owner-removing write with every other grant write on the page and with
     * workspace member removal. Acquires the workspace lock before the document row lock
     * (matching {@code WorkspaceService.removeMember}'s {@code Workspace -> Document} order)
     * before authorization checks so those checks, the loaded document, and member
     * removal all observe committed post-lock state.
     */
    private void lockForOwnershipChange(UUID documentId) {
        // An absent id locks nothing and lets the subsequent gate throw NOT_FOUND.
        documentRepository.findWorkspaceIdById(documentId).ifPresent(workspaceRepository::findByIdForUpdate);
        documentRepository.findByIdForOwnershipUpdate(documentId);
    }

    private DocumentAccessLevel currentLevel(Document doc, UUID userId) {
        return doc.getDeletedAt() != null
                ? permissionService.resolveTrashAccess(userId, doc.getId())
                : permissionService.resolveAccess(userId, doc.getId());
    }

    private User resolveActor(UUID actorId, Document doc) {
        User creator = doc.getCreator();
        if (creator != null && actorId.equals(creator.getId())) {
            return creator;
        }
        return userRepository
                .findById(actorId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Acting user not found."));
    }

    private DocumentAccessResponse computeAccess(UUID userId, UUID documentId) {
        Document doc = documentRepository.findByIdAndDeletedAtIsNull(documentId).orElse(null);
        if (doc == null) {
            // Strict: realtime connection gating relies on trashed documents being denied here.
            return new DocumentAccessResponse(documentId, false, null, false, true);
        }
        return computeActiveAccess(userId, documentId, doc, false);
    }

    private DocumentAccessResponse computeActiveAccess(
            UUID userId, UUID documentId, Document doc, boolean includeSharingContext) {
        // Resolve through SQL even for an owner: an archived space caps every level,
        // ownership included, at VIEW. Realtime treats OWNER as a write grant, so a
        // short-circuit here would keep an archived space editable for page owners.
        DocumentAccessLevel level = permissionService.resolveAccess(userId, documentId);
        if (level == null) {
            return new DocumentAccessResponse(documentId, false, null, false, false, false, null);
        }
        boolean isOwner = level == DocumentAccessLevel.OWNER;
        if (!includeSharingContext) {
            return new DocumentAccessResponse(documentId, true, level, isOwner, false);
        }
        SharingContext sharing = resolveSharingContext(userId, doc, level);
        return new DocumentAccessResponse(
                documentId, true, level, isOwner, false, sharing.canManageSharing(), sharing.space());
    }

    /**
     * Sharing authority and the space display summary for one document. A page
     * inside a space reports its space so the share panel can show the space
     * members row and the workspace-wide grant row. Sharing follows the same
     * closest-ancestor rule as content: an effective page OWNER may administer
     * sharing, and space administration (OWNER or workspace admin) remains the
     * fallback even for a caller without a page grant. A private page has no space,
     * so only a page owner or an ancestor owner administers it; a workspace role is
     * not a grant there. An archived space freezes sharing and caps every effective
     * level at VIEW.
     */
    private SharingContext resolveSharingContext(UUID userId, Document doc, DocumentAccessLevel effectiveLevel) {
        Space space = permissionService.resolveSpace(doc);
        if (space == null) {
            // A private page keeps the workspace id but lives in its creator's personal
            // section, outside the workspace/space hierarchy, so a workspace role is not
            // a grant on it. Owning the page or an ancestor is the only sharing authority.
            boolean manage = effectiveLevel == DocumentAccessLevel.OWNER || permissionService.ownsAncestor(userId, doc);
            return new SharingContext(manage, null);
        }

        boolean pageOwner = effectiveLevel == DocumentAccessLevel.OWNER;
        boolean archived = space.getArchivedAt() != null;
        SpaceContext context;
        try {
            context = spaceAccessService.load(userId, space.getId());
        } catch (ApiException ex) {
            if (ex.getErrorCode() == ErrorCode.NOT_FOUND) {
                // A page OWNER need not be a space member (an explicit grant can
                // share with anyone); they still get their sharing rights, just
                // without a space summary to render.
                return new SharingContext(
                        !archived && (pageOwner || permissionService.ownsAncestor(userId, doc)), null);
            }
            throw ex;
        }
        DocumentAccessLevel myAccessLevel =
                archived && context.accessLevel() != null ? DocumentAccessLevel.VIEW : context.accessLevel();
        DocumentSpaceResponse summary = new DocumentSpaceResponse(
                space.getId(),
                space.getName(),
                space.getAccessMode(),
                space.getEveryoneAccessLevel(),
                myAccessLevel,
                context.canAdminister(),
                archived);
        return new SharingContext(
                !archived && (pageOwner || context.canAdminister() || permissionService.ownsAncestor(userId, doc)),
                summary);
    }

    private static DocumentAccessLevel levelOf(AccessGrant grant) {
        return grant.getEffect() == AccessGrantEffect.DENY || grant.getAccessLevel() == null
                ? DocumentAccessLevel.NO_ACCESS
                : grant.getAccessLevel();
    }

    private static DocumentAccessLevel normalizeCollaboratorAccess(DocumentAccessLevel accessLevel) {
        if (accessLevel == null) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "accessLevel is required.");
        }
        return accessLevel;
    }

    /**
     * Subtree reconcile works in fixed-size chunks: a collaborator write used to cost
     * two recursive CTEs plus lazy parent/owner selects per document in the subtree.
     * Each chunk now costs one id query (shared), one entity load, one parent-link
     * query and one access batch, whatever the subtree width.
     */
    private static final int RECONCILE_CHUNK_SIZE = 500;

    private void reconcileSharedRoots(UUID userId, UUID subtreeRootId) {
        User user = userRepository.findById(userId).orElse(null);
        if (user == null) {
            return;
        }
        List<UUID> subtreeIds = documentRepository.findSubtreeDocumentIds(subtreeRootId);
        if (subtreeIds.isEmpty()) {
            return;
        }

        // Decide first, mutate last: UserSharedOrder deletes clear the persistence context,
        // detaching the subtree documents loaded above. Touching a lazy association afterwards
        // (doc.getParent().getCreator()) would fail with LazyInitializationException, so every
        // access resolution has to happen before the first order row is deleted.
        List<Document> documentsToFloat = new ArrayList<>();
        List<UUID> orderRowsToDelete = new ArrayList<>();
        for (int start = 0; start < subtreeIds.size(); start += RECONCILE_CHUNK_SIZE) {
            List<UUID> chunk = subtreeIds.subList(start, Math.min(start + RECONCILE_CHUNK_SIZE, subtreeIds.size()));
            decideSharedRoots(userId, chunk, documentsToFloat, orderRowsToDelete);
        }

        if (!documentsToFloat.isEmpty()) {
            sharedSectionService.ensureOrderRows(user, documentsToFloat);
        }
        for (UUID docId : orderRowsToDelete) {
            userSharedOrderRepository.deleteByUser_IdAndDocument_Id(userId, docId);
        }
    }

    private void decideSharedRoots(
            UUID userId, List<UUID> chunk, List<Document> documentsToFloat, List<UUID> orderRowsToDelete) {
        Set<UUID> chunkIds = new HashSet<>(chunk);
        Map<UUID, UUID> parentById = new HashMap<>();
        for (Object[] row : documentRepository.findParentIdsByIdIn(chunk)) {
            Object parent = row[1];
            parentById.put(
                    (UUID) row[0],
                    parent instanceof UUID u ? u : (parent != null ? UUID.fromString(parent.toString()) : null));
        }
        // Parents of chunk rows can sit in another chunk: resolve every parent
        // alongside the chunk so the accessible-parent check never misses.
        Set<UUID> loadIds = new HashSet<>(chunk);
        for (UUID parentId : parentById.values()) {
            if (parentId != null) {
                loadIds.add(parentId);
            }
        }
        Map<UUID, DocumentAccessLevel> accessById = permissionService.resolveIdentityAccessBatch(userId, loadIds);
        List<Document> subtreeDocs = new ArrayList<>();
        for (Document doc : documentRepository.findAllForChainByIdIn(loadIds)) {
            if (chunkIds.contains(doc.getId())) {
                subtreeDocs.add(doc);
            }
        }

        for (Document doc : subtreeDocs) {
            DocumentAccessLevel access = accessById.get(doc.getId());
            if (access != null && !hasAccessibleParent(doc.getId(), parentById, accessById)) {
                documentsToFloat.add(doc);
            } else {
                orderRowsToDelete.add(doc.getId());
            }
        }
    }

    private boolean hasAccessibleParent(
            UUID documentId, Map<UUID, UUID> parentById, Map<UUID, DocumentAccessLevel> accessById) {
        UUID parentId = parentById.get(documentId);
        return parentId != null && accessById.get(parentId) != null;
    }

    private boolean canViewSpaceRoster(UUID requesterId, Space space) {
        if (spaceMemberRepository.existsBySpace_IdAndUser_Id(space.getId(), requesterId)) {
            return true;
        }
        try {
            SpaceContext context = spaceAccessService.load(requesterId, space.getId());
            if (context == null) {
                return false;
            }
            if (context.workspaceAdmin()) {
                return true;
            }
            return space.getAccessMode() != SpaceAccessMode.PUBLIC && context.accessLevel() != null;
        } catch (ApiException ex) {
            return false;
        }
    }

    /**
     * Where an inherited grant comes from. {@code everyoneAccess} marks the space's
     * everyone-else baseline, which no row can override: it grants a level to the whole
     * workspace, not to one person.
     */
    private record AncestorGrantInfo(UUID docId, String title, DocumentAccessLevel level, boolean everyoneAccess) {
        AncestorGrantInfo(UUID docId, String title, DocumentAccessLevel level) {
            this(docId, title, level, false);
        }
    }

    private record SharingContext(boolean canManageSharing, DocumentSpaceResponse space) {
        private static final SharingContext NONE = new SharingContext(false, null);
    }
}
