package com.nextdocs.api.document.service;

import com.nextdocs.api.audit.entity.AccessAuditAction;
import com.nextdocs.api.audit.service.AccessAuditService;
import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
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
import com.nextdocs.api.document.entity.UserDocumentOrder;
import com.nextdocs.api.document.repository.AccessGrantRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.repository.UserDocumentOrderRepository;
import com.nextdocs.api.document.util.FractionalIndex;
import com.nextdocs.api.realtime.event.DocumentAccessChangedEvent;
import com.nextdocs.api.space.entity.Space;
import com.nextdocs.api.space.entity.SpaceAccessMode;
import com.nextdocs.api.space.entity.SpaceMember;
import com.nextdocs.api.space.repository.SpaceMemberRepository;
import com.nextdocs.api.space.service.SpaceAccessService;
import com.nextdocs.api.space.service.SpaceAccessService.SpaceContext;
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

    private final DocumentRepository documentRepository;
    private final AccessGrantRepository accessGrantRepository;
    private final UserDocumentOrderRepository userDocumentOrderRepository;
    private final UserRepository userRepository;
    private final PermissionService permissionService;
    private final SpaceAccessService spaceAccessService;
    private final SpaceMemberRepository spaceMemberRepository;
    private final AccessGrantSyncService accessGrantSyncService;
    private final AccessAuditService auditService;
    private final ApplicationEventPublisher eventPublisher;

    @Autowired
    @Lazy
    private DocumentSharingService selfProxy;

    @Transactional(readOnly = true)
    public List<CollaboratorResponse> listCollaborators(UUID requesterId, UUID documentId) {
        Document doc = permissionService.requireReadAccessIncludingTrash(requesterId, documentId);
        requireIdentityGrantForRoster(requesterId, doc);

        Set<UUID> directUserIds = new HashSet<>();
        List<CollaboratorResponse> result = new ArrayList<>();

        Space space = permissionService.resolveSpace(doc);
        if (space == null) {
            // 1. Direct document owner (only standalone documents have an owner)
            User owner = doc.getUser();
            directUserIds.add(owner.getId());
            result.add(new CollaboratorResponse(
                    owner.getId(),
                    owner.getEmail(),
                    owner.getDisplayName(),
                    DocumentAccessLevel.OWNER,
                    doc.getCreatedAt(),
                    true,
                    false,
                    null,
                    null,
                    null));
        }

        // 2. Direct page grants from the canonical store.
        List<AccessGrant> directGrants = accessGrantRepository.findUserGrantsByDocumentId(documentId);
        for (AccessGrant grant : directGrants) {
            if (space == null && grant.getUser().getId().equals(doc.getUser().getId())) {
                continue;
            }
            directUserIds.add(grant.getUser().getId());
        }

        // 3. Inherited user grants from ancestors
        AncestorContext ancestorContext = loadAncestorContext(doc);
        Map<UUID, AncestorGrantInfo> directAncestorGrants = new HashMap<>();
        Set<UUID> handledDirectUserIds = new HashSet<>();
        Set<UUID> handledAncestorUserIds = new HashSet<>();
        List<CollaboratorResponse> inheritedResponses = new ArrayList<>();

        // Title masking needs the requester's access per ancestor: one batch
        // query for the whole chain instead of one recursive CTE per level.
        Map<UUID, DocumentAccessLevel> ancestorAccessById = permissionService.resolveAccessBatch(
                requesterId,
                ancestorContext.ancestors().stream().map(Document::getId).toList());

        for (Document ancestor : ancestorContext.ancestors()) {
            String ancestorTitle;
            if (requesterId.equals(ancestor.getUser().getId()) || ancestorAccessById.get(ancestor.getId()) != null) {
                ancestorTitle = SharingDocuments.titleOrUntitled(ancestor);
            } else {
                ancestorTitle = "Parent document";
            }

            // Ancestor owner (only standalone trees carry ancestor owners)
            if (space == null) {
                User ancestorOwner = ancestor.getUser();
                UUID ownerId = ancestorOwner.getId();
                if (directUserIds.contains(ownerId) && handledDirectUserIds.add(ownerId)) {
                    directAncestorGrants.put(
                            ownerId, new AncestorGrantInfo(ancestor.getId(), ancestorTitle, DocumentAccessLevel.OWNER));
                }
                if (!directUserIds.contains(ownerId) && handledAncestorUserIds.add(ownerId)) {
                    inheritedResponses.add(new CollaboratorResponse(
                            ancestorOwner.getId(),
                            ancestorOwner.getEmail(),
                            ancestorOwner.getDisplayName(),
                            DocumentAccessLevel.OWNER,
                            ancestor.getCreatedAt(),
                            false,
                            true,
                            ancestor.getId(),
                            ancestorTitle,
                            null));
                }
            }

            // Ancestor user grants. The first row for a person wins, so a nearer
            // NO_ACCESS breakpoint blocks farther positive rows.
            for (AccessGrant grant : ancestorContext.grantsByDocument().getOrDefault(ancestor.getId(), List.of())) {
                UUID uid = grant.getUser().getId();
                DocumentAccessLevel level = levelOf(grant);
                if (directUserIds.contains(uid)) {
                    if (handledDirectUserIds.add(uid) && level != DocumentAccessLevel.NO_ACCESS) {
                        directAncestorGrants.put(uid, new AncestorGrantInfo(ancestor.getId(), ancestorTitle, level));
                    }
                } else if (handledAncestorUserIds.add(uid) && level != DocumentAccessLevel.NO_ACCESS) {
                    inheritedResponses.add(new CollaboratorResponse(
                            grant.getUser().getId(),
                            grant.getUser().getEmail(),
                            grant.getUser().getDisplayName(),
                            level,
                            grant.getCreatedAt(),
                            false,
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
            // Provenance reflects the stored grant origin on the SpaceMember row,
            // not the resolver output. If a public space everyone baseline broadens
            // effective capability, that appears in effectiveAccessLevel so admins
            // still see what was explicitly configured.
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
                            sm.getAccessLevel(),
                            sm.getCreatedAt(),
                            false,
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
                                uid, new AncestorGrantInfo(space.getId(), spaceTitle, space.getEveryoneAccessLevel()));
                    }
                }
            }
        }

        for (AccessGrant grant : directGrants) {
            UUID uid = grant.getUser().getId();
            if (space == null && uid.equals(doc.getUser().getId())) {
                continue;
            }
            AncestorGrantInfo grantInfo = directAncestorGrants.get(uid);
            result.add(new CollaboratorResponse(
                    uid,
                    grant.getUser().getEmail(),
                    grant.getUser().getDisplayName(),
                    levelOf(grant),
                    grant.getCreatedAt(),
                    false,
                    false,
                    grantInfo != null ? grantInfo.docId() : null,
                    grantInfo != null ? grantInfo.title() : null,
                    grantInfo != null ? grantInfo.level() : null));
        }

        result.addAll(inheritedResponses);
        attachEffectiveAccessLevels(doc, result);
        return result;
    }

    /**
     * Reports what each roster row can actually do here. The stored grant stays in
     * {@code accessLevel} (that is what the dropdown edits); the effective level
     * accounts for a space cap, the archive, or a NO_ACCESS breakpoint, so a page
     * owner demoted by space membership no longer renders as "Full access".
     */
    private void attachEffectiveAccessLevels(Document doc, List<CollaboratorResponse> rows) {
        if (rows.isEmpty()) {
            return;
        }
        List<UUID> userIds =
                rows.stream().map(CollaboratorResponse::userId).distinct().toList();
        Map<UUID, DocumentAccessLevel> effective =
                permissionService.resolveAccessForUsers(doc.getId(), userIds, doc.getDeletedAt() != null);
        if (effective.isEmpty()) {
            // A stubbed/older resolver answered nothing: keep the stored level
            // rather than erasing every row's label.
            return;
        }
        for (int i = 0; i < rows.size(); i++) {
            CollaboratorResponse row = rows.get(i);
            if (!effective.containsKey(row.userId())) {
                continue;
            }
            rows.set(
                    i,
                    new CollaboratorResponse(
                            row.userId(),
                            row.email(),
                            row.displayName(),
                            row.accessLevel(),
                            row.addedAt(),
                            row.owner(),
                            row.inherited(),
                            row.inheritedFromId(),
                            row.inheritedFromTitle(),
                            row.inheritedAccessLevel(),
                            effective.get(row.userId()) == null
                                    ? DocumentAccessLevel.NO_ACCESS
                                    : effective.get(row.userId())));
        }
    }

    public CollaboratorResponse upsertCollaborator(UUID actorId, UUID documentId, CollaboratorUpsertRequest request) {
        int attempt = 0;
        while (true) {
            try {
                return selfProxy != null
                        ? selfProxy.upsertCollaboratorAndPersist(actorId, documentId, request)
                        : upsertCollaboratorAndPersist(actorId, documentId, request);
            } catch (DataIntegrityViolationException ex) {
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
        Document doc = permissionService.requireSharingAdminAccess(actorId, documentId);
        DocumentAccessLevel requestedLevel = normalizeCollaboratorAccess(request.accessLevel());
        if (requestedLevel == DocumentAccessLevel.NO_ACCESS) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "NO_ACCESS is not allowed for collaborator invites.");
        }

        User targetUser = userRepository
                .findByEmail(request.email().strip().toLowerCase())
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "User not found for the provided email."));

        Space space = permissionService.resolveSpace(doc);
        if (space == null && targetUser.getId().equals(doc.getUser().getId())) {
            throw new ApiException(ErrorCode.CONFLICT, "Document owner already has owner access.");
        }

        if (targetUser.getId().equals(actorId)) {
            throw new ApiException(ErrorCode.CONFLICT, "Cannot modify own collaborator access.");
        }

        User actor = resolveActor(actorId, doc);

        // Any inherited grant - including an ancestor owner's full access - is overridable
        // on this document; a direct grant always wins over the ancestor walk.
        AccessGrant saved = accessGrantSyncService.upsertUserGrant(doc, targetUser, requestedLevel, actor);
        auditService.recordDocument(
                doc,
                actorId,
                AccessAuditAction.COLLABORATOR_UPSERT,
                "USER",
                targetUser.getId(),
                "level=" + requestedLevel);

        // Ensure the collaborator has a UserDocumentOrder entry for their Shared
        // section so root documents and floated nested documents can be reordered.
        ensureCollaboratorOrder(doc, targetUser);
        eventPublisher.publishEvent(new DocumentAccessChangedEvent(documentId, List.of(targetUser.getId())));

        return new CollaboratorResponse(
                saved.getUser().getId(),
                saved.getUser().getEmail(),
                saved.getUser().getDisplayName(),
                levelOf(saved),
                saved.getCreatedAt(),
                false);
    }

    @Transactional
    public void updateCollaboratorAccess(
            UUID actorId, UUID documentId, UUID collaboratorUserId, CollaboratorAccessUpdateRequest request) {
        Document doc = permissionService.requireSharingAdminAccess(actorId, documentId);

        if (actorId.equals(collaboratorUserId)) {
            throw new ApiException(ErrorCode.CONFLICT, "Cannot modify own collaborator access.");
        }

        Space space = permissionService.resolveSpace(doc);
        if (space == null && doc.getUser().getId().equals(collaboratorUserId)) {
            // The document's own owner resolves as OWNER at depth 0, so an override row
            // here would be inert; reject it instead of storing dead state.
            throw new ApiException(ErrorCode.CONFLICT, "Owner access cannot be overridden or removed.");
        }

        DocumentAccessLevel requestedLevel = normalizeCollaboratorAccess(request.accessLevel());
        User actor = resolveActor(actorId, doc);

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
                userDocumentOrderRepository.deleteByUser_IdAndDocument_Id(collaboratorUserId, documentId);
            } else {
                accessGrantSyncService.upsertUserGrant(doc, targetUser, DocumentAccessLevel.NO_ACCESS, actor);
                userDocumentOrderRepository.deleteByUser_IdAndDocument_Id(collaboratorUserId, documentId);
            }
        } else {
            accessGrantSyncService.upsertUserGrant(doc, targetUser, requestedLevel, actor);
            ensureCollaboratorOrder(doc, targetUser);
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
        Document doc = permissionService.requireSharingAdminAccess(actorId, documentId);

        if (actorId.equals(collaboratorUserId)) {
            throw new ApiException(ErrorCode.CONFLICT, "Cannot remove yourself as collaborator. Use leave instead.");
        }

        Space space = permissionService.resolveSpace(doc);
        if (space == null && doc.getUser().getId().equals(collaboratorUserId)) {
            throw new ApiException(ErrorCode.CONFLICT, "Owner cannot be removed from collaborators.");
        }

        boolean exists = accessGrantRepository.existsByDocument_IdAndUser_Id(documentId, collaboratorUserId);
        if (!exists) {
            throw new ApiException(
                    ErrorCode.NOT_FOUND,
                    "Collaborator not found. Inherited access is managed with a NO_ACCESS override.");
        }

        accessGrantRepository.deleteByDocument_IdAndUser_Id(documentId, collaboratorUserId);
        userDocumentOrderRepository.deleteByUser_IdAndDocument_Id(collaboratorUserId, documentId);
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

        Space space = permissionService.resolveSpace(doc);
        if (space == null && doc.getUser().getId().equals(userId)) {
            throw new ApiException(ErrorCode.CONFLICT, "Owners cannot leave their own documents.");
        }

        Optional<AccessGrant> grant = accessGrantRepository.findByDocument_IdAndUser_Id(documentId, userId);
        if (grant.isEmpty()) {
            throw new ApiException(
                    ErrorCode.NOT_FOUND,
                    "Collaborator not found. Inherited access cannot be left; ask an admin for a NO_ACCESS override.");
        }
        if (grant.get().getEffect() != AccessGrantEffect.ALLOW) {
            throw new ApiException(ErrorCode.CONFLICT, "A page-level No access rule can only be removed by an admin.");
        }

        accessGrantRepository.deleteByDocument_IdAndUser_Id(documentId, userId);
        userDocumentOrderRepository.deleteByUser_IdAndDocument_Id(userId, documentId);
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
        // `owner` means direct ownership only, matching the active path above — an
        // OWNER-level collaborator reports accessLevel=OWNER with owner=false.
        DocumentAccessLevel trashAccess = permissionService.resolveTrashAccess(userId, documentId);
        if (trashAccess == null) {
            return new DocumentAccessResponse(documentId, false, null, false, true, false, null);
        }
        Document trashed = documentRepository.findById(documentId).orElse(null);
        Space space = trashed != null ? permissionService.resolveSpace(trashed) : null;
        boolean owner =
                space == null && trashed != null && trashed.getUser().getId().equals(userId);
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

    private void ensureCollaboratorOrder(Document doc, User targetUser) {
        if (userDocumentOrderRepository.existsByUser_IdAndDocument_Id(targetUser.getId(), doc.getId())) {
            return;
        }
        String minKey = userDocumentOrderRepository
                .findMinOrderKeyByUserId(targetUser.getId(), doc.getId())
                .filter(FractionalIndex::isValidOrderKey)
                .orElse(null);
        UserDocumentOrder udo = UserDocumentOrder.builder()
                .user(targetUser)
                .document(doc)
                .orderKey(FractionalIndex.keyBetween(null, minKey))
                .build();
        userDocumentOrderRepository.saveAndFlush(udo);
    }

    private User resolveActor(UUID actorId, Document doc) {
        if (actorId.equals(doc.getUser().getId())) {
            return doc.getUser();
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
        Space space = permissionService.resolveSpace(doc);
        boolean isOwner = space == null && doc.getUser().getId().equals(userId);
        // Resolve through SQL even for the owner: an archived space caps every level,
        // ownership included, at VIEW. Realtime treats OWNER as a write grant, so a
        // short-circuit here would keep an archived space editable for page owners.
        DocumentAccessLevel level = permissionService.resolveAccess(userId, documentId);
        if (level == null) {
            return new DocumentAccessResponse(documentId, false, null, false, false, false, null);
        }
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
     * fallback even for a caller without a page grant. An archived space freezes
     * sharing and caps every effective level at VIEW.
     */
    private SharingContext resolveSharingContext(UUID userId, Document doc, DocumentAccessLevel effectiveLevel) {
        Space space = permissionService.resolveSpace(doc);
        if (space == null) {
            return new SharingContext(effectiveLevel == DocumentAccessLevel.OWNER, null);
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
                return new SharingContext(!archived && pageOwner, null);
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
        return new SharingContext(!archived && (pageOwner || context.canAdminister()), summary);
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

        // Decide first, mutate last: UserDocumentOrder deletes clear the persistence context,
        // detaching the subtree documents loaded above. Touching a lazy association afterwards
        // (doc.getParent().getUser()) would fail with LazyInitializationException, so every
        // access resolution has to happen before the first order row is deleted.
        List<Document> documentsToFloat = new ArrayList<>();
        List<UUID> orderRowsToDelete = new ArrayList<>();
        for (int start = 0; start < subtreeIds.size(); start += RECONCILE_CHUNK_SIZE) {
            List<UUID> chunk = subtreeIds.subList(start, Math.min(start + RECONCILE_CHUNK_SIZE, subtreeIds.size()));
            decideSharedRoots(userId, chunk, documentsToFloat, orderRowsToDelete);
        }

        for (Document doc : documentsToFloat) {
            ensureCollaboratorOrder(doc, user);
        }
        for (UUID docId : orderRowsToDelete) {
            userDocumentOrderRepository.deleteByUser_IdAndDocument_Id(userId, docId);
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
        Map<UUID, UUID> ownerById = new HashMap<>();
        List<Document> subtreeDocs = new ArrayList<>();
        for (Document doc : documentRepository.findAllWithUserByIdIn(loadIds)) {
            ownerById.put(doc.getId(), doc.getUser().getId());
            if (chunkIds.contains(doc.getId())) {
                subtreeDocs.add(doc);
            }
        }

        for (Document doc : subtreeDocs) {
            if (userId.equals(ownerById.get(doc.getId()))) {
                continue;
            }
            DocumentAccessLevel access = accessById.get(doc.getId());
            if (access != null && !hasAccessibleParent(userId, doc.getId(), parentById, ownerById, accessById)) {
                documentsToFloat.add(doc);
            } else {
                orderRowsToDelete.add(doc.getId());
            }
        }
    }

    private boolean hasAccessibleParent(
            UUID userId,
            UUID documentId,
            Map<UUID, UUID> parentById,
            Map<UUID, UUID> ownerById,
            Map<UUID, DocumentAccessLevel> accessById) {
        UUID parentId = parentById.get(documentId);
        if (parentId == null) {
            return false;
        }
        return userId.equals(ownerById.get(parentId)) || accessById.get(parentId) != null;
    }

    /**
     * Hierarchical picture for one document, loaded in a fixed number of queries whatever
     * the tree depth: the reachable ancestor chain and each ancestor's user grant rows.
     */
    private AncestorContext loadAncestorContext(Document doc) {
        List<Document> ancestors = SharingDocuments.loadReachableAncestors(documentRepository, doc);
        if (ancestors.isEmpty()) {
            return new AncestorContext(List.of(), Map.of());
        }

        Map<UUID, List<AccessGrant>> rowsByDocument = new HashMap<>();
        for (AccessGrant row : accessGrantRepository.findUserGrantsByDocumentIdIn(
                ancestors.stream().map(Document::getId).toList())) {
            rowsByDocument
                    .computeIfAbsent(row.getDocument().getId(), key -> new ArrayList<>())
                    .add(row);
        }
        return new AncestorContext(ancestors, rowsByDocument);
    }

    /**
     * Roster visibility requires an identity grant (owner, user/group grant,
     * space baseline, or workspace audience). Link-only readers can open the document but must
     * not enumerate member emails and names. Masked as not found so link
     * holders cannot distinguish a private document from a hidden roster.
     */
    private void requireIdentityGrantForRoster(UUID requesterId, Document doc) {
        Space space = permissionService.resolveSpace(doc);
        if (space == null && doc.getUser().getId().equals(requesterId)) {
            return;
        }
        if (accessGrantRepository.hasPositiveIdentityGrant(requesterId, doc.getId())) {
            return;
        }
        if (hasSpaceGrant(requesterId, doc)) {
            return;
        }
        throw new ApiException(ErrorCode.NOT_FOUND);
    }

    /**
     * A space grant is an identity grant: a space member already sees the space roster, so
     * hiding this page's roster from them would be theatre. Space administrators count too,
     * even without a content level, because sharing is their call. In a public space, workspace
     * members pass here to inspect direct document collaborators (space rows are still filtered
     * by {@code canViewSpaceRoster}). Anonymous or external link-only readers outside the workspace
     * have no workspace identity and are masked as not found.
     */
    private boolean hasSpaceGrant(UUID userId, Document doc) {
        Space space = permissionService.resolveSpace(doc);
        if (space == null) {
            return false;
        }
        try {
            SpaceContext context = spaceAccessService.load(userId, space.getId());
            return context != null && (context.accessLevel() != null || context.canAdminister());
        } catch (ApiException ex) {
            if (ex.getErrorCode() == ErrorCode.NOT_FOUND) {
                return false;
            }
            throw ex;
        }
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

    private record AncestorContext(List<Document> ancestors, Map<UUID, List<AccessGrant>> grantsByDocument) {}

    private record AncestorGrantInfo(UUID docId, String title, DocumentAccessLevel level) {}

    private record SharingContext(boolean canManageSharing, DocumentSpaceResponse space) {
        private static final SharingContext NONE = new SharingContext(false, null);
    }
}
