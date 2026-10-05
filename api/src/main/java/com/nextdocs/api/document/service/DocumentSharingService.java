package com.nextdocs.api.document.service;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.dto.request.CollaboratorAccessUpdateRequest;
import com.nextdocs.api.document.dto.request.CollaboratorUpsertRequest;
import com.nextdocs.api.document.dto.request.SharingSettingsUpdateRequest;
import com.nextdocs.api.document.dto.response.CollaboratorResponse;
import com.nextdocs.api.document.dto.response.DocumentAccessResponse;
import com.nextdocs.api.document.dto.response.SharingSettingsResponse;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.entity.DocumentCollaborator;
import com.nextdocs.api.document.entity.DocumentGeneralAccessMode;
import com.nextdocs.api.document.entity.UserDocumentOrder;
import com.nextdocs.api.document.repository.DocumentCollaboratorRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.repository.UserDocumentOrderRepository;
import com.nextdocs.api.document.util.FractionalIndex;
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
import org.springframework.context.annotation.Lazy;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class DocumentSharingService {

    private static final int MAX_ORDER_UPSERT_ATTEMPTS = 3;

    private final DocumentRepository documentRepository;
    private final DocumentCollaboratorRepository collaboratorRepository;
    private final UserDocumentOrderRepository userDocumentOrderRepository;
    private final UserRepository userRepository;
    private final PermissionService permissionService;

    @Autowired
    @Lazy
    private DocumentSharingService selfProxy;

    @Transactional(readOnly = true)
    public List<CollaboratorResponse> listCollaborators(UUID requesterId, UUID documentId) {
        Document doc = permissionService.requireReadAccessIncludingTrash(requesterId, documentId);

        Set<UUID> directUserIds = new HashSet<>();
        List<CollaboratorResponse> result = new ArrayList<>();

        // 1. Direct document owner
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

        // 2. Direct collaborators on this document
        List<DocumentCollaborator> directCollaborators = collaboratorRepository.findAllByDocument_Id(documentId);
        Set<UUID> directNeedsAncestor = new HashSet<>();
        for (DocumentCollaborator c : directCollaborators) {
            UUID uid = c.getUser().getId();
            directUserIds.add(uid);
            if (collaboratorRepository.hasPositiveAncestorGrant(uid, documentId)) {
                directNeedsAncestor.add(uid);
            }
        }

        // 3. Hierarchical / inherited collaborators from ancestors
        Map<UUID, AncestorGrantInfo> directAncestorGrants = new HashMap<>();
        Set<UUID> handledAncestorUserIds = new HashSet<>();
        List<CollaboratorResponse> inheritedResponses = new ArrayList<>();

        Document current = doc.getParent();
        int depth = 0;
        while (current != null && depth < 100) {
            if (current.getDeletedAt() == null) {
                String ancestorTitle;
                if (requesterId.equals(current.getUser().getId())
                        || permissionService.resolveAccess(requesterId, current.getId()) != null) {
                    ancestorTitle =
                            current.getTitle() != null && !current.getTitle().isBlank()
                                    ? current.getTitle()
                                    : "Untitled";
                } else {
                    ancestorTitle = "Parent document";
                }

                // Ancestor owner
                User ancestorOwner = current.getUser();
                UUID ownerId = ancestorOwner.getId();
                if (directNeedsAncestor.contains(ownerId)) {
                    directAncestorGrants.put(
                            ownerId, new AncestorGrantInfo(current.getId(), ancestorTitle, DocumentAccessLevel.OWNER));
                    directNeedsAncestor.remove(ownerId);
                }
                if (!directUserIds.contains(ownerId) && !handledAncestorUserIds.contains(ownerId)) {
                    handledAncestorUserIds.add(ownerId);
                    inheritedResponses.add(new CollaboratorResponse(
                            ancestorOwner.getId(),
                            ancestorOwner.getEmail(),
                            ancestorOwner.getDisplayName(),
                            DocumentAccessLevel.OWNER,
                            current.getCreatedAt(),
                            false,
                            true,
                            current.getId(),
                            ancestorTitle,
                            null));
                }

                // Ancestor collaborators
                List<DocumentCollaborator> ancestorCollaborators =
                        collaboratorRepository.findAllByDocument_Id(current.getId());
                for (DocumentCollaborator ac : ancestorCollaborators) {
                    UUID uid = ac.getUser().getId();
                    if (directNeedsAncestor.contains(uid)) {
                        if (ac.getAccessLevel() == DocumentAccessLevel.NO_ACCESS) {
                            // A breakpoint between the document and a farther positive
                            // grant means removing the direct row would still leave
                            // the user blocked, so there is no live ancestor source
                            // to attribute (and no truthful "Inherit" target).
                            directNeedsAncestor.remove(uid);
                        } else {
                            directAncestorGrants.put(
                                    uid, new AncestorGrantInfo(current.getId(), ancestorTitle, ac.getAccessLevel()));
                            directNeedsAncestor.remove(uid);
                        }
                    }

                    if (!directUserIds.contains(uid) && !handledAncestorUserIds.contains(uid)) {
                        handledAncestorUserIds.add(uid);
                        if (ac.getAccessLevel() != DocumentAccessLevel.NO_ACCESS) {
                            inheritedResponses.add(new CollaboratorResponse(
                                    ac.getUser().getId(),
                                    ac.getUser().getEmail(),
                                    ac.getUser().getDisplayName(),
                                    ac.getAccessLevel(),
                                    ac.getCreatedAt(),
                                    false,
                                    true,
                                    current.getId(),
                                    ancestorTitle,
                                    null));
                        }
                    }
                }
            } else {
                // resolve_effective_access stops at trashed ancestors, so grants above the
                // trash bundle never apply; never surface phantom inherited collaborators.
                break;
            }
            current = current.getParent();
            depth++;
        }

        for (DocumentCollaborator c : directCollaborators) {
            UUID uid = c.getUser().getId();
            AncestorGrantInfo grantInfo = directAncestorGrants.get(uid);
            UUID inheritedFromId = grantInfo != null ? grantInfo.docId() : null;
            String inheritedFromTitle = grantInfo != null ? grantInfo.title() : null;
            DocumentAccessLevel inheritedAccessLevel = grantInfo != null ? grantInfo.level() : null;

            result.add(new CollaboratorResponse(
                    c.getUser().getId(),
                    c.getUser().getEmail(),
                    c.getUser().getDisplayName(),
                    c.getAccessLevel(),
                    c.getCreatedAt(),
                    false,
                    false,
                    inheritedFromId,
                    inheritedFromTitle,
                    inheritedAccessLevel));
        }

        result.addAll(inheritedResponses);
        return result;
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

        if (targetUser.getId().equals(doc.getUser().getId())) {
            throw new ApiException(ErrorCode.CONFLICT, "Document owner already has owner access.");
        }

        if (targetUser.getId().equals(actorId)) {
            throw new ApiException(ErrorCode.CONFLICT, "Cannot modify own collaborator access.");
        }

        // Any inherited grant - including an ancestor owner's full access - is overridable
        // on this document; a direct row always wins over the ancestor walk.
        DocumentCollaborator collaborator = collaboratorRepository
                .findByDocument_IdAndUser_Id(documentId, targetUser.getId())
                .orElseGet(() -> DocumentCollaborator.builder()
                        .document(doc)
                        .user(targetUser)
                        .build());

        collaborator.setAccessLevel(requestedLevel);
        User actor = actorId.equals(doc.getUser().getId())
                ? doc.getUser()
                : userRepository
                        .findById(actorId)
                        .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Acting user not found."));
        collaborator.setGrantedBy(actor);

        DocumentCollaborator saved = collaboratorRepository.save(collaborator);

        // Ensure the collaborator has a UserDocumentOrder entry for their Shared
        // section so root documents and floated nested documents can be reordered.
        ensureCollaboratorOrder(doc, targetUser);

        return new CollaboratorResponse(
                saved.getUser().getId(),
                saved.getUser().getEmail(),
                saved.getUser().getDisplayName(),
                saved.getAccessLevel(),
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

        if (doc.getUser().getId().equals(collaboratorUserId)) {
            // The document's own owner resolves as OWNER at depth 0, so an override row
            // here would be inert; reject it instead of storing dead state.
            throw new ApiException(ErrorCode.CONFLICT, "Owner access cannot be overridden or removed.");
        }

        DocumentAccessLevel requestedLevel = normalizeCollaboratorAccess(request.accessLevel());

        boolean hasAncestorGrant = collaboratorRepository.hasPositiveAncestorGrant(collaboratorUserId, documentId);
        Optional<DocumentCollaborator> collaboratorOpt =
                collaboratorRepository.findByDocument_IdAndUser_Id(documentId, collaboratorUserId);

        if (collaboratorOpt.isEmpty() && !hasAncestorGrant) {
            throw new ApiException(ErrorCode.NOT_FOUND, "Collaborator not found.");
        }

        if (requestedLevel == DocumentAccessLevel.NO_ACCESS) {
            if (!hasAncestorGrant) {
                if (collaboratorOpt.isPresent()) {
                    collaboratorRepository.deleteByDocument_IdAndUser_Id(documentId, collaboratorUserId);
                    userDocumentOrderRepository.deleteByUser_IdAndDocument_Id(collaboratorUserId, documentId);
                }
            } else {
                DocumentCollaborator collaborator = collaboratorOpt.orElseGet(() -> {
                    User targetUser = userRepository
                            .findById(collaboratorUserId)
                            .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Collaborator user not found."));
                    User actor = actorId.equals(doc.getUser().getId())
                            ? doc.getUser()
                            : userRepository
                                    .findById(actorId)
                                    .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Acting user not found."));
                    return DocumentCollaborator.builder()
                            .document(doc)
                            .user(targetUser)
                            .grantedBy(actor)
                            .build();
                });
                collaborator.setAccessLevel(DocumentAccessLevel.NO_ACCESS);
                collaboratorRepository.save(collaborator);
                userDocumentOrderRepository.deleteByUser_IdAndDocument_Id(collaboratorUserId, documentId);
            }
        } else {
            DocumentCollaborator collaborator = collaboratorOpt.orElseGet(() -> {
                User targetUser = userRepository
                        .findById(collaboratorUserId)
                        .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Collaborator user not found."));
                User actor = actorId.equals(doc.getUser().getId())
                        ? doc.getUser()
                        : userRepository
                                .findById(actorId)
                                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Acting user not found."));
                return DocumentCollaborator.builder()
                        .document(doc)
                        .user(targetUser)
                        .grantedBy(actor)
                        .build();
            });
            collaborator.setAccessLevel(requestedLevel);
            collaboratorRepository.save(collaborator);
            ensureCollaboratorOrder(doc, collaborator.getUser());
        }

        reconcileSharedRoots(collaboratorUserId, documentId);
        collaboratorRepository.pruneOrphanedBreakpoints(documentId);
    }

    @Transactional
    public void removeCollaborator(UUID actorId, UUID documentId, UUID collaboratorUserId) {
        Document doc = permissionService.requireSharingAdminAccess(actorId, documentId);

        if (actorId.equals(collaboratorUserId)) {
            throw new ApiException(ErrorCode.CONFLICT, "Cannot remove yourself as collaborator. Use leave instead.");
        }

        if (doc.getUser().getId().equals(collaboratorUserId)) {
            throw new ApiException(ErrorCode.CONFLICT, "Owner cannot be removed from collaborators.");
        }

        boolean exists = collaboratorRepository.existsByDocument_IdAndUser_Id(documentId, collaboratorUserId);
        if (!exists) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }

        collaboratorRepository.deleteByDocument_IdAndUser_Id(documentId, collaboratorUserId);
        userDocumentOrderRepository.deleteByUser_IdAndDocument_Id(collaboratorUserId, documentId);

        reconcileSharedRoots(collaboratorUserId, documentId);
        collaboratorRepository.pruneOrphanedBreakpoints(documentId);
    }

    @Transactional
    public void leaveSharedDocument(UUID userId, UUID documentId) {
        Document doc = permissionService.requireReadAccessIncludingTrash(userId, documentId);

        if (doc.getUser().getId().equals(userId)) {
            throw new ApiException(ErrorCode.CONFLICT, "Owners cannot leave their own documents.");
        }

        boolean exists = collaboratorRepository.existsByDocument_IdAndUser_Id(documentId, userId);
        if (!exists) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }

        collaboratorRepository.deleteByDocument_IdAndUser_Id(documentId, userId);
        userDocumentOrderRepository.deleteByUser_IdAndDocument_Id(userId, documentId);

        // Leaving may orphan NO_ACCESS breakpoints deeper in the subtree; if this user is
        // later re-granted access on an ancestor those stale rows would spring back to life.
        reconcileSharedRoots(userId, documentId);
        collaboratorRepository.pruneOrphanedBreakpoints(documentId);
    }

    @Transactional(readOnly = true)
    public SharingSettingsResponse getSharingSettings(UUID actorId, UUID documentId) {
        Document doc = permissionService.requireSharingAdminAccess(actorId, documentId);
        boolean hasActiveLink = doc.getGeneralAccessMode() == DocumentGeneralAccessMode.ANYONE_WITH_LINK;

        if (doc.isLinkInheritBlocked()) {
            // Own block shadows every ancestor grant (mirrors a NO_ACCESS
            // breakpoint): the document is effectively private on the link
            // channel regardless of ancestors.
            ShadowedGrant shadowed = findShadowedLinkGrant(doc);
            return new SharingSettingsResponse(
                    doc.getGeneralAccessMode(),
                    doc.getLinkAccessLevel(),
                    hasActiveLink,
                    false,
                    shadowed != null ? shadowed.docId() : null,
                    shadowed != null ? shadowed.title() : null,
                    true);
        }

        if (doc.getParent() != null) {
            Document current = doc.getParent();
            int depth = 0;
            while (current != null && depth < 100) {
                if (current.getDeletedAt() != null) {
                    // resolve_effective_access stops at trashed ancestors, so link grants
                    // above the trash bundle never apply.
                    break;
                }
                if (current.isLinkInheritBlocked()) {
                    // A blocked ancestor shadows grants above it (mirrors
                    // resolve_public_access), so nothing below inherits.
                    break;
                }
                if (current.getGeneralAccessMode() == DocumentGeneralAccessMode.ANYONE_WITH_LINK) {
                    String title =
                            current.getTitle() != null && !current.getTitle().isBlank()
                                    ? current.getTitle()
                                    : "Untitled";
                    if (!hasActiveLink) {
                        return new SharingSettingsResponse(
                                doc.getGeneralAccessMode(),
                                // The child's own link level only takes effect when its own mode is
                                // ANYONE_WITH_LINK; here the ancestor's level is the effective one.
                                current.getLinkAccessLevel(),
                                false,
                                true,
                                current.getId(),
                                title,
                                false);
                    }
                    // Own link overrides the ancestor grant (closest-ancestor-wins),
                    // but surface the ancestor source so the UI can show
                    // "Overrides <parent>" like collaborator overrides.
                    return new SharingSettingsResponse(
                            doc.getGeneralAccessMode(),
                            doc.getLinkAccessLevel(),
                            true,
                            false,
                            current.getId(),
                            title,
                            false);
                }
                current = current.getParent();
                depth++;
            }
        }

        return new SharingSettingsResponse(
                doc.getGeneralAccessMode(), doc.getLinkAccessLevel(), hasActiveLink, false, null, null, false);
    }

    /**
     * Finds the nearest reachable ancestor ANYONE_WITH_LINK grant shadowed by a block,
     * for display only ("Inherit from X").
     * Traversal bound: Walks up to 100 parent nodes (lazy selects bounded at depth <= 100).
     * Trashed ancestors stop resolution. Intervening blocks also stop resolution because
     * an already-blocked parent leaves no reachable link grant for descendants to shadow.
     */
    private ShadowedGrant findShadowedLinkGrant(Document doc) {
        Document current = doc.getParent();
        int depth = 0;
        while (current != null && depth < 100) {
            if (current.getDeletedAt() != null) {
                break;
            }
            if (current.isLinkInheritBlocked()) {
                break;
            }
            if (current.getGeneralAccessMode() == DocumentGeneralAccessMode.ANYONE_WITH_LINK) {
                String title =
                        current.getTitle() != null && !current.getTitle().isBlank() ? current.getTitle() : "Untitled";
                return new ShadowedGrant(current.getId(), title);
            }
            current = current.getParent();
            depth++;
        }
        return null;
    }

    @Transactional
    public SharingSettingsResponse updateSharingSettings(
            UUID actorId, UUID documentId, SharingSettingsUpdateRequest request) {
        Document doc = permissionService.requireSharingAdminAccess(actorId, documentId);

        DocumentGeneralAccessMode mode = request.generalAccessMode();
        if (mode == null) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "generalAccessMode is required.");
        }

        doc.setGeneralAccessMode(mode);
        if (request.linkAccessLevel() != null) {
            doc.setLinkAccessLevel(normalizeLinkAccess(request.linkAccessLevel()));
        }
        if (mode == DocumentGeneralAccessMode.ANYONE_WITH_LINK) {
            // An own link always wins by closest-ancestor-wins, so a stored
            // block would be dead state: clear it like a direct collaborator
            // row overwriting a NO_ACCESS breakpoint.
            doc.setLinkInheritBlocked(false);
        } else if (request.linkInheritBlocked() != null) {
            doc.setLinkInheritBlocked(request.linkInheritBlocked());
        }
        if (doc.isLinkInheritBlocked()
                && doc.getGeneralAccessMode() == DocumentGeneralAccessMode.RESTRICTED
                && findShadowedLinkGrant(doc) == null) {
            // A block without an ancestor grant denies nothing (mirrors a
            // NO_ACCESS row with no ancestor grant, which is deleted instead of
            // stored): normalize so the flag always implies a shadowed grant.
            doc.setLinkInheritBlocked(false);
        }

        documentRepository.save(doc);
        // Return full provenance (inherited / Overrides) like getSharingSettings
        // so the UI can immediately show override badges without a reload.
        return getSharingSettings(actorId, documentId);
    }

    @Transactional(readOnly = true)
    public DocumentAccessResponse getMyAccess(UUID userId, UUID documentId) {
        Document active =
                documentRepository.findByIdAndDeletedAtIsNull(documentId).orElse(null);
        if (active != null) {
            return computeActiveAccess(userId, documentId, active);
        }

        // Trashed documents: report the caller's pre-trash access so the UI can offer a
        // read-only trash view (any level) versus manage actions (EDIT and above).
        // `owner` means direct ownership only, matching the active path above — an
        // OWNER-level collaborator reports accessLevel=OWNER with owner=false.
        DocumentAccessLevel trashAccess = permissionService.resolveTrashAccess(userId, documentId);
        if (trashAccess == null) {
            return new DocumentAccessResponse(documentId, false, null, false, true);
        }
        boolean owner = documentRepository
                .findById(documentId)
                .map(doc -> doc.getUser().getId().equals(userId))
                .orElse(false);
        return new DocumentAccessResponse(documentId, true, trashAccess, owner, true);
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

    private DocumentAccessResponse computeAccess(UUID userId, UUID documentId) {
        Document doc = documentRepository.findByIdAndDeletedAtIsNull(documentId).orElse(null);
        if (doc == null) {
            // Strict: realtime connection gating relies on trashed documents being denied here.
            return new DocumentAccessResponse(documentId, false, null, false, true);
        }
        return computeActiveAccess(userId, documentId, doc);
    }

    private DocumentAccessResponse computeActiveAccess(UUID userId, UUID documentId, Document doc) {
        boolean isOwner = doc.getUser().getId().equals(userId);
        if (isOwner) {
            return new DocumentAccessResponse(documentId, true, DocumentAccessLevel.OWNER, true, false);
        }

        DocumentAccessLevel level = permissionService.resolveAccess(userId, documentId);
        if (level == null) {
            return new DocumentAccessResponse(documentId, false, null, false, false);
        }
        return new DocumentAccessResponse(documentId, true, level, false, false);
    }

    private static DocumentAccessLevel normalizeCollaboratorAccess(DocumentAccessLevel accessLevel) {
        if (accessLevel == null) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "accessLevel is required.");
        }
        return accessLevel;
    }

    private static DocumentAccessLevel normalizeLinkAccess(DocumentAccessLevel accessLevel) {
        if (accessLevel == null) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "accessLevel is required.");
        }
        if (accessLevel == DocumentAccessLevel.OWNER) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "OWNER is not allowed for share links.");
        }
        if (accessLevel == DocumentAccessLevel.NO_ACCESS) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "NO_ACCESS is not allowed for share links.");
        }
        return accessLevel;
    }

    private void reconcileSharedRoots(UUID userId, UUID subtreeRootId) {
        User user = userRepository.findById(userId).orElse(null);
        if (user == null) {
            return;
        }
        List<UUID> subtreeIds = documentRepository.findSubtreeDocumentIds(subtreeRootId);
        if (subtreeIds.isEmpty()) {
            return;
        }
        List<Document> subtreeDocs = documentRepository.findAllById(subtreeIds);

        // Decide first, mutate last: UserDocumentOrder deletes clear the persistence context,
        // detaching the subtree documents loaded above. Touching a lazy association afterwards
        // (doc.getParent().getUser()) would fail with LazyInitializationException, so every
        // access resolution has to happen before the first order row is deleted.
        List<Document> documentsToFloat = new ArrayList<>();
        List<UUID> orderRowsToDelete = new ArrayList<>();
        for (Document doc : subtreeDocs) {
            if (doc.getUser().getId().equals(userId)) {
                continue;
            }
            DocumentAccessLevel access = permissionService.resolveAccess(userId, doc.getId());
            if (access != null && !hasAccessibleParent(userId, doc)) {
                documentsToFloat.add(doc);
            } else {
                orderRowsToDelete.add(doc.getId());
            }
        }

        for (Document doc : documentsToFloat) {
            ensureCollaboratorOrder(doc, user);
        }
        for (UUID docId : orderRowsToDelete) {
            userDocumentOrderRepository.deleteByUser_IdAndDocument_Id(userId, docId);
        }
    }

    private boolean hasAccessibleParent(UUID userId, Document doc) {
        Document parent = doc.getParent();
        if (parent == null) {
            return false;
        }
        return parent.getUser().getId().equals(userId)
                || permissionService.resolveAccess(userId, parent.getId()) != null;
    }

    private record AncestorGrantInfo(UUID docId, String title, DocumentAccessLevel level) {}

    private record ShadowedGrant(UUID docId, String title) {}
}
