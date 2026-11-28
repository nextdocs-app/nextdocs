package com.nextdocs.api.document.service;

import static com.nextdocs.api.document.config.DocumentProperties.MAX_TREE_DEPTH;

import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.dto.request.DocumentMoveRequest;
import com.nextdocs.api.document.dto.response.DocumentResponse;
import com.nextdocs.api.document.dto.response.DocumentResponses;
import com.nextdocs.api.document.dto.response.SharedEntry;
import com.nextdocs.api.document.entity.AccessGrant;
import com.nextdocs.api.document.entity.AccessGrantEffect;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.entity.DocumentOrderSection;
import com.nextdocs.api.document.entity.UserDocumentOrder;
import com.nextdocs.api.document.entity.UserSharedOrder;
import com.nextdocs.api.document.repository.AccessGrantRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.repository.UserDocumentOrderRepository;
import com.nextdocs.api.document.repository.UserSharedOrderRepository;
import com.nextdocs.api.document.util.FractionalIndex;
import com.nextdocs.api.document.util.OrderInterval;
import com.nextdocs.api.document.util.OrderPositionConflict;
import com.nextdocs.api.realtime.event.DocumentAccessChangedEvent;
import com.nextdocs.api.space.entity.Space;
import com.nextdocs.api.space.service.SpaceAccessService;
import com.nextdocs.api.user.entity.User;
import com.nextdocs.api.user.repository.UserRepository;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.repository.WorkspaceRepository;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.Lazy;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Slf4j
@Service
@RequiredArgsConstructor
public class DocumentTreeService {

    private static final int MAX_MOVE_ATTEMPTS = 3;

    private static final int REINDEX_GAP = 8;

    private final DocumentRepository documentRepository;
    private final AccessGrantRepository accessGrantRepository;
    private final UserDocumentOrderRepository userDocumentOrderRepository;
    private final UserSharedOrderRepository userSharedOrderRepository;
    private final SharedSectionService sharedSectionService;
    private final UserRepository userRepository;
    private final PermissionService permissionService;
    private final AccessGrantSyncService accessGrantSyncService;
    private final SpaceAccessService spaceAccessService;
    private final WorkspaceRepository workspaceRepository;
    private final ApplicationEventPublisher eventPublisher;

    @Autowired
    @Lazy
    private DocumentTreeService selfProxy;

    public DocumentResponse move(UUID userId, UUID documentId, DocumentMoveRequest request) {
        int attempt = 0;
        while (true) {
            try {
                DocumentResponse response = selfProxy != null
                        ? selfProxy.moveAndPersist(userId, documentId, request, attempt > 0)
                        : moveAndPersist(userId, documentId, request, attempt > 0);
                // A reparent changes the inherited access of the whole moved subtree, and a
                // reorder inside a space can change what its members see first. Either way
                // the open sockets must re-authorize against the new chain.
                eventPublisher.publishEvent(new DocumentAccessChangedEvent(documentId));
                return response;
            } catch (DataIntegrityViolationException ex) {
                // Only a duplicate position can be rebuilt and retried; anything else
                // would fail identically on every attempt.
                if (!OrderPositionConflict.isRetryable(ex)) {
                    throw ex;
                }
                log.warn(
                        "Concurrent position change during move attempt={} userId={} documentId={}",
                        attempt,
                        userId,
                        documentId,
                        ex);
                attempt++;
                if (attempt >= MAX_MOVE_ATTEMPTS) {
                    throw new ApiException(ErrorCode.CONFLICT, "The position changed concurrently. Please retry.");
                }
            }
        }
    }

    @Transactional
    public DocumentResponse moveAndPersist(
            UUID userId, UUID documentId, DocumentMoveRequest request, boolean rebuildFirst) {
        // The same page cannot be both neighbours. Every namespace would answer with one
        // key twice, and the interval would be empty only when that key happens to be the
        // last one: a malformed request must not read as a position race the caller retries.
        if (request.prevSiblingId() != null && request.prevSiblingId().equals(request.nextSiblingId())) {
            throw new ApiException(
                    ErrorCode.VALIDATION_FAILED, "A document cannot be both the previous and the next sibling.");
        }
        // A SHARED tag is the Shared tree's own navigation. A root-level drop is always a
        // section reorder: the page keeps its parent, its space and its tree key, and only
        // the caller's personal position moves. A drop that stays under the page's current
        // parent is a section reorder only while the page is a section entry: the tree also
        // renders the children of a shared page, which the listing excludes because their
        // parent is readable, and those drops are real sibling reorders that take the
        // EDIT-gated path below instead of failing the section lookup.
        if (request.section() == DocumentOrderSection.SHARED) {
            Document sharedDoc = documentRepository
                    .findByIdAndDeletedAtIsNull(documentId)
                    .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
            boolean samePlacement = request.newParentId() == null
                    || (sharedDoc.getParent() != null
                            && sharedDoc.getParent().getId().equals(request.newParentId()));
            if (samePlacement
                    && (request.newParentId() == null || sharedSectionService.isInSection(userId, documentId))) {
                return reorderShared(userId, sharedDoc, request, rebuildFirst);
            }
        }
        if (request.newParentId() != null) {
            return reparent(userId, documentId, request, rebuildFirst);
        }
        Document doc = documentRepository
                .findByIdAndDeletedAtIsNull(documentId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
        if (doc.getParent() == null && doc.getSpace() != null) {
            // A member reorders a space root through the space, whose order is shared
            // content. A caller who only holds a page grant cannot browse that space, so
            // the page is a Shared entry for them and the drag is personal instead.
            if (request.section() == DocumentOrderSection.PRIVATE) {
                throw new ApiException(ErrorCode.VALIDATION_FAILED, "A space page is not part of the Private section.");
            }
            if (request.section() == null && sharedSectionService.isInSection(userId, documentId)) {
                return reorderShared(userId, doc, request, rebuildFirst);
            }
            return moveSpaceRootPage(userId, doc, request, rebuildFirst);
        }
        // An explicit SHARED section was answered above, so this is either the inferred
        // case or the Private tree naming the namespace it expects. One lookup answers
        // both, so a rejected or accepted move never scans the section twice.
        boolean inSharedSection = sharedSectionService.isInSection(userId, documentId);
        if (request.section() == DocumentOrderSection.PRIVATE) {
            if (inSharedSection) {
                throw new ApiException(
                        ErrorCode.VALIDATION_FAILED, "This document is not part of the Private section.");
            }
        } else if (request.section() == null && inSharedSection) {
            return reorderShared(userId, doc, request, rebuildFirst);
        }
        return reorderPrivateRoots(userId, documentId, doc, request, rebuildFirst);
    }

    /**
     * Re-parents a page, or reorders it among the siblings it lands beside. EDIT is enough
     * for a reorder, but only an owner may graft the subtree into another document.
     */
    private DocumentResponse reparent(UUID userId, UUID documentId, DocumentMoveRequest request, boolean rebuildFirst) {
        Document doc = permissionService.requireEditAccess(userId, documentId);
        int newParentChainNodes = validateNoCycle(documentId, request.newParentId());
        validateSubtreeFitsDepth(documentId, newParentChainNodes);
        Document newParent = permissionService.requireEditAccess(userId, request.newParentId());
        // Dropping among the current siblings is a reorder, not a reparent: an
        // editor does not need the move-authorization required to graft the
        // subtree somewhere new, and ownership must stay with its author.
        boolean sameParent = doc.getParent() != null && doc.getParent().getId().equals(newParent.getId());
        if (!sameParent) {
            validateReparentAuthorization(userId, doc);
        }

        if (rebuildFirst) {
            reindexSiblings(request.newParentId());
        }

        String prevKey = resolveSiblingNeighborKey(request.prevSiblingId(), documentId, request.newParentId());
        String nextKey = resolveSiblingNeighborKey(request.nextSiblingId(), documentId, request.newParentId());

        if (prevKey != null && nextKey != null && prevKey.compareTo(nextKey) > 0) {
            String lower = prevKey;
            prevKey = nextKey;
            nextKey = lower;
        }

        if (prevKey != null && !FractionalIndex.isValidOrderKey(prevKey)
                || nextKey != null && !FractionalIndex.isValidOrderKey(nextKey)
                || prevKey != null && prevKey.equals(nextKey)) {
            reindexSiblings(request.newParentId());
            prevKey = resolveSiblingNeighborKey(request.prevSiblingId(), documentId, request.newParentId());
            nextKey = resolveSiblingNeighborKey(request.nextSiblingId(), documentId, request.newParentId());

            if (prevKey != null && nextKey != null && prevKey.compareTo(nextKey) > 0) {
                String lower = prevKey;
                prevKey = nextKey;
                nextKey = lower;
            }
        }

        if (prevKey == null && nextKey == null) {
            prevKey = documentRepository
                    .findMaxSiblingOrderKey(request.newParentId(), documentId)
                    .filter(FractionalIndex::isValidOrderKey)
                    .orElse(null);
        }

        String newSiblingOrderKey;
        try {
            newSiblingOrderKey = FractionalIndex.keyBetween(prevKey, nextKey);
        } catch (IllegalArgumentException ex) {
            log.warn("Invalid sibling key interval: prevKey={} nextKey={}", prevKey, nextKey, ex);
            throw new ApiException(ErrorCode.CONFLICT, "The position changed concurrently. Please retry.");
        }
        Document saved;
        if (sameParent) {
            doc.setSiblingOrderKey(newSiblingOrderKey);
            saved = documentRepository.saveAndFlush(doc);
        } else {
            // A destination inside a space keeps the creator attribution: the space is
            // the permission anchor, so the move must not rewrite the author or prune
            // page-level NO_ACCESS breakpoints against it.
            boolean joinsSpace = permissionService.resolveSpace(newParent) != null;

            // A space anchors at a root page only (V24's chk_documents_space_root), so a
            // page moved under another page drops its own anchor. If the destination is in
            // the same space, that space still anchors the page through the new ancestor.
            doc.setParent(newParent);
            doc.setSiblingOrderKey(newSiblingOrderKey);
            doc.setSpace(null);
            adoptHostTreeWorkspace(doc, newParent.getWorkspace());
            saved = documentRepository.saveAndFlush(doc);

            if (!joinsSpace) {
                // A nested page has no Private root order for any user. Shared orders
                // live in their own table and remain intact.
                userDocumentOrderRepository.deleteByDocument_Id(documentId);

                // Collect new-ancestor owners in fixed queries instead of one lazy
                // parent load plus one delete CTE per level.
                List<UUID> ancestorIds = new ArrayList<>();
                ancestorIds.add(newParent.getId());
                ancestorIds.addAll(documentRepository.findAncestorChainIds(newParent.getId()));
                Set<UUID> ownerIds = new HashSet<>();
                for (AccessGrant ancestorGrant : accessGrantRepository.findUserGrantsByDocumentIdIn(ancestorIds)) {
                    if (ancestorGrant.getEffect() == AccessGrantEffect.ALLOW
                            && ancestorGrant.getAccessLevel() == DocumentAccessLevel.OWNER) {
                        ownerIds.add(ancestorGrant.getUser().getId());
                    }
                }
                for (UUID ownerId : ownerIds) {
                    accessGrantRepository.deleteDenyInSubtreeForUser(documentId, ownerId);
                }
                accessGrantRepository.pruneOrphanedBreakpoints(documentId);
            }
        }

        boolean hasChildren = documentRepository.existsNonTrashedChildrenByParentId(documentId);
        boolean hasCollaborators = accessGrantRepository.existsPositiveGrantByDocumentId(documentId);
        DocumentAccessLevel access = permissionService.resolveAccess(userId, documentId);
        return DocumentResponses.of(
                saved, newParent.getId(), newSiblingOrderKey, hasChildren, hasCollaborators, access, null, null);
    }

    /**
     * Root-level personal order for the Private tree, plus the detach path for a nested
     * space page. The key is the caller's own navigation, so only a page the caller owns
     * enters this namespace: a collaborator's position lives in the Shared table, and a
     * private row for them would reopen the invariant V44's migration establishes.
     *
     * <p>A Private page dragged to the root is detached from its tree and becomes the
     * caller's own standalone root, so only an OWNER may do it and the page gets the
     * explicit OWNER grant every root needs (V50). A Shared-section page never reaches
     * that write: the section check below answers it first.
     */
    private DocumentResponse reorderPrivateRoots(
            UUID userId, UUID documentId, Document targetDoc, DocumentMoveRequest request, boolean rebuildFirst) {
        Space targetSpace = permissionService.resolveSpace(targetDoc);
        if (targetDoc.getParent() != null && targetSpace != null) {
            // A page inside a space leaves its parent only through an explicit detach: the
            // root-level drop has nowhere else to put it, so keeping the parent and writing
            // a Private row would file a page the caller may not even own into their own
            // navigation and answer a no-op as if it had moved.
            if (!Boolean.TRUE.equals(request.detachFromParent())) {
                throw new ApiException(
                        ErrorCode.VALIDATION_FAILED,
                        "A page inside a space cannot be reordered at the root level. Detach it from its parent first.");
            }
            // Unparenting a page inside a space detaches it from the space container:
            // only active space administrators may move content out of the space.
            spaceAccessService.requireActiveAdministration(userId, targetSpace.getId());
        }
        if (targetSpace == null && sharedSectionService.isInSection(userId, documentId)) {
            // Answer an unreadable page as missing before naming the namespace, so this
            // cannot confirm a stranger's document exists.
            permissionService.requireReadAccess(userId, documentId);
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "This document is not part of the Private section.");
        }
        if (targetDoc.getParent() != null) {
            // Detaching a nested page turns it into a standalone root; serialize with
            // WorkspaceService.removeMember in Workspace -> Document order before checking
            // post-lock permissions and writing the root's OWNER grant.
            documentRepository.findWorkspaceIdById(documentId).ifPresent(workspaceRepository::findByIdForUpdate);
            documentRepository.findByIdForOwnershipUpdate(documentId);
        }
        permissionService.requireEditAccess(userId, documentId);
        Document doc = targetDoc;

        // Detaching a Private page to the root changes who owns it, so it needs the same
        // authority as grafting it under another document. An editor dropping it here
        // would pull the page out of the owner's tree and into their own; a Shared-section
        // page is rejected above instead of reaching this gate.
        if (doc.getParent() != null
                && targetSpace == null
                && permissionService.resolveAccess(userId, documentId) != DocumentAccessLevel.OWNER) {
            throw new ApiException(ErrorCode.FORBIDDEN, "Only document owners may detach a page to the root.");
        }

        if (rebuildFirst) {
            reindexUserOrders(userId);
        }

        String prevKey = resolveUserNeighborKey(userId, request.prevSiblingId(), documentId);
        String nextKey = resolveUserNeighborKey(userId, request.nextSiblingId(), documentId);

        // A stale or duplicate neighbour key cannot anchor an interval: rebuild this
        // caller's own keys and read the neighbours again before computing anything.
        if (prevKey != null && !FractionalIndex.isValidOrderKey(prevKey)
                || nextKey != null && !FractionalIndex.isValidOrderKey(nextKey)
                || prevKey != null && prevKey.equals(nextKey)) {
            reindexUserOrders(userId);
            prevKey = resolveUserNeighborKey(userId, request.prevSiblingId(), documentId);
            nextKey = resolveUserNeighborKey(userId, request.nextSiblingId(), documentId);
        }

        // This namespace now holds only the caller's own navigation, so the requested
        // pair is all the interval has to respect. OrderInterval widens it to the real
        // neighbours in case a row the client cannot see sits between them.
        String newUserOrderKey;
        try {
            newUserOrderKey = OrderInterval.placeBetween(prevKey, nextKey, new OrderInterval.Neighbors() {
                @Override
                public String after(String key) {
                    return userDocumentOrderRepository
                            .findMinOrderKeyGreaterThan(userId, key, documentId)
                            .filter(FractionalIndex::isValidOrderKey)
                            .orElse(null);
                }

                @Override
                public String before(String key) {
                    return userDocumentOrderRepository
                            .findMaxOrderKeyLessThan(userId, key, documentId)
                            .filter(FractionalIndex::isValidOrderKey)
                            .orElse(null);
                }

                @Override
                public String last() {
                    return userDocumentOrderRepository
                            .findMaxOrderKeyByUserId(userId, documentId)
                            .filter(FractionalIndex::isValidOrderKey)
                            .orElse(null);
                }
            });
        } catch (IllegalArgumentException ex) {
            log.warn("Invalid user order key interval: prevKey={} nextKey={}", prevKey, nextKey, ex);
            throw new ApiException(ErrorCode.CONFLICT, "The position changed concurrently. Please retry.");
        }

        User user = userRepository.findById(userId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));

        if (doc.getParent() != null) {
            // Either a space detach or a Private unparent ends the ancestor chain, so the
            // page becomes a standalone root and needs its own OWNER row: resolution is
            // grants-only (V50), and without it the page would resolve to nobody and
            // vanish from every listing. Space content belongs to the container, so the
            // administrator performing the detach owns it; in Private it is the owner who
            // pulled the page out of their own tree. Descendants inherit from this root.
            accessGrantSyncService.upsertUserGrant(doc, user, DocumentAccessLevel.OWNER, user);
            doc.setParent(null);
            doc.setSiblingOrderKey(null);
            documentRepository.saveAndFlush(doc);
            // A root document has no ancestors, so any NO_ACCESS breakpoint in this
            // subtree just lost the positive ancestor grant that justified it.
            accessGrantRepository.pruneOrphanedBreakpoints(documentId);
        }

        UserDocumentOrder udo = userDocumentOrderRepository
                .findByUser_IdAndDocument_Id(userId, documentId)
                .orElseGet(() ->
                        UserDocumentOrder.builder().user(user).document(doc).build());
        udo.setOrderKey(newUserOrderKey);
        userDocumentOrderRepository.saveAndFlush(udo);

        for (AccessGrant grant : accessGrantRepository.findPositiveUserGrantsByDocumentId(documentId)) {
            ensureCollaboratorRootOrder(doc, grant);
        }

        boolean hasChildren = documentRepository.existsNonTrashedChildrenByParentId(documentId);
        boolean hasCollaborators = accessGrantRepository.existsPositiveGrantByDocumentId(documentId);
        // Ownership is a level here, not a property of the creator row: a creator who
        // stepped down must get their stored level back, not OWNER.
        DocumentAccessLevel access = permissionService.resolveAccess(userId, documentId);

        UUID resultParentId = doc.getParent() != null ? doc.getParent().getId() : null;

        return DocumentResponses.of(
                doc, resultParentId, newUserOrderKey, hasChildren, hasCollaborators, access, null, null);
    }

    /**
     * Reparenting changes a document's location and access chain. EDIT is enough to
     * reorder it among its current siblings, but only an OWNER of the document may
     * graft it into another document.
     *
     * <p>The resolver applies page overrides to inherited space access, including
     * inherited OWNER membership.
     */
    private void validateReparentAuthorization(UUID userId, Document doc) {
        if (permissionService.resolveAccess(userId, doc.getId()) != DocumentAccessLevel.OWNER) {
            throw new ApiException(
                    ErrorCode.FORBIDDEN, "Only document owners may move a document into another document.");
        }
    }

    /**
     * Moves a document and all of its descendants into the destination workspace. Page
     * access stays with the page chain, so only the tenant changes here.
     */
    private void adoptHostTreeWorkspace(Document doc, Workspace targetWorkspace) {
        if (targetWorkspace == null
                || (doc.getWorkspace() != null
                        && doc.getWorkspace().getId() != null
                        && doc.getWorkspace().getId().equals(targetWorkspace.getId()))) {
            return;
        }
        doc.setWorkspace(targetWorkspace);
        List<UUID> frontier = List.of(doc.getId());
        int depth = 0;
        while (!frontier.isEmpty()) {
            if (depth >= MAX_TREE_DEPTH) {
                throw new ApiException(ErrorCode.VALIDATION_FAILED, "Document tree is too deep or contains a cycle.");
            }
            List<Document> children = documentRepository.findAllByParent_IdIn(frontier);
            if (children.isEmpty()) {
                break;
            }
            for (Document child : children) {
                child.setWorkspace(targetWorkspace);
            }
            documentRepository.saveAll(children);
            frontier = children.stream().map(Document::getId).toList();
            depth++;
        }
    }

    private void reindexSiblings(UUID parentId) {
        List<Document> siblings = documentRepository.findAllSiblingsForReindex(parentId);
        if (siblings.isEmpty()) return;
        // Park every page on a temporary key first: a page's final key can equal a
        // sibling's current key, and idx_documents_parent_sibling_order_key_unique rejects
        // that transient state whatever order the flush happens to write rows in.
        for (int i = 0; i < siblings.size(); i++) {
            siblings.get(i).setSiblingOrderKey("~reindex-" + i);
        }
        documentRepository.flush();

        String[] newKeys = FractionalIndex.nKeysBetweenSpaced(null, null, siblings.size(), REINDEX_GAP);
        for (int i = 0; i < siblings.size(); i++) {
            siblings.get(i).setSiblingOrderKey(newKeys[i]);
        }
        documentRepository.flush();
    }

    /**
     * Reorders one entry in the caller's Shared view. The document's parent, space and
     * {@code sibling_order_key} are never written: a Shared drag is navigation, not a
     * content move, so VIEW access is enough and a space page keeps its place in the
     * space for every other member.
     */
    private DocumentResponse reorderShared(
            UUID userId, Document doc, DocumentMoveRequest request, boolean rebuildFirst) {
        if (rebuildFirst) {
            sharedSectionService.reindex(userId);
        }
        // One listing scan both normalizes missing keys and supplies the neighbours;
        // the move path must not re-scan the section for each question it asks.
        List<SharedEntry> entries = sharedSectionService.ensureOrders(
                userId, doc.getId(), request.prevSiblingId(), request.nextSiblingId());
        String newOrderKey;
        SharedEntry moved;
        try {
            // The interval is read and the row written under the account lock: a grant that
            // seeds this user's section at the same moment computes its top key from the
            // same listing, and both would land on keyBetween(null, firstKey).
            sharedSectionService.lockOrderWrites(userId);
            // The listing above ran unlocked, so another drag or grant may have changed a
            // neighbour's key while this transaction waited for the lock. The interval has
            // to come from the section as it reads under the lock.
            entries = sharedSectionService.list(userId);
            moved = entries.stream()
                    .filter(entry -> entry.id().equals(doc.getId()))
                    .findFirst()
                    .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
            newOrderKey = sharedSectionService.keyBetweenSiblings(
                    userId, entries, doc.getId(), request.prevSiblingId(), request.nextSiblingId());
        } catch (IllegalArgumentException ex) {
            log.warn("Invalid Shared order interval: documentId={}", doc.getId(), ex);
            throw new ApiException(ErrorCode.CONFLICT, "The position changed concurrently. Please retry.");
        }

        User user = userRepository.findById(userId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
        UserSharedOrder order = userSharedOrderRepository
                .findByUser_IdAndDocument_Id(userId, doc.getId())
                .orElseGet(
                        () -> UserSharedOrder.builder().user(user).document(doc).build());
        order.setOrderKey(newOrderKey);
        userSharedOrderRepository.saveAndFlush(order);

        boolean hasChildren = documentRepository.existsNonTrashedChildrenByParentId(doc.getId());
        boolean hasCollaborators = accessGrantRepository.existsPositiveGrantByDocumentId(doc.getId());
        return DocumentResponses.shared(
                doc,
                moved.parentId(),
                newOrderKey,
                hasChildren,
                hasCollaborators,
                moved.accessLevel(),
                moved.spaceId(),
                moved.owner());
    }

    private DocumentResponse moveSpaceRootPage(
            UUID userId, Document doc, DocumentMoveRequest request, boolean rebuildFirst) {
        permissionService.requireEditAccess(userId, doc.getId());
        UUID spaceId = doc.getSpace().getId();

        if (rebuildFirst) {
            reindexSpaceSiblings(spaceId);
        }

        String prevKey = resolveSpaceSiblingNeighborKey(request.prevSiblingId(), doc.getId(), spaceId);
        String nextKey = resolveSpaceSiblingNeighborKey(request.nextSiblingId(), doc.getId(), spaceId);

        if (prevKey != null && nextKey != null && prevKey.compareTo(nextKey) > 0) {
            String lower = prevKey;
            prevKey = nextKey;
            nextKey = lower;
        }

        if (prevKey != null && !FractionalIndex.isValidOrderKey(prevKey)
                || nextKey != null && !FractionalIndex.isValidOrderKey(nextKey)
                || prevKey != null && prevKey.equals(nextKey)) {
            reindexSpaceSiblings(spaceId);
            prevKey = resolveSpaceSiblingNeighborKey(request.prevSiblingId(), doc.getId(), spaceId);
            nextKey = resolveSpaceSiblingNeighborKey(request.nextSiblingId(), doc.getId(), spaceId);

            if (prevKey != null && nextKey != null && prevKey.compareTo(nextKey) > 0) {
                String lower = prevKey;
                prevKey = nextKey;
                nextKey = lower;
            }
        }

        if (prevKey == null && nextKey == null) {
            prevKey = documentRepository
                    .findMaxSpaceSiblingOrderKey(spaceId, doc.getId())
                    .filter(FractionalIndex::isValidOrderKey)
                    .orElse(null);
        }

        String newSiblingOrderKey;
        try {
            newSiblingOrderKey = FractionalIndex.keyBetween(prevKey, nextKey);
        } catch (IllegalArgumentException ex) {
            log.warn("Invalid space sibling key interval: prevKey={} nextKey={}", prevKey, nextKey, ex);
            throw new ApiException(ErrorCode.CONFLICT, "The position changed concurrently. Please retry.");
        }

        doc.setSiblingOrderKey(newSiblingOrderKey);
        Document saved = documentRepository.saveAndFlush(doc);

        boolean hasChildren = documentRepository.existsNonTrashedChildrenByParentId(doc.getId());
        boolean hasCollaborators = accessGrantRepository.existsPositiveGrantByDocumentId(doc.getId());
        DocumentAccessLevel access = permissionService.resolveAccess(userId, doc.getId());
        return DocumentResponses.of(saved, null, newSiblingOrderKey, hasChildren, hasCollaborators, access, null, null);
    }

    private void reindexSpaceSiblings(UUID spaceId) {
        List<Document> siblings = documentRepository.findAllSpaceRootSiblingsForReindex(spaceId);
        if (siblings.isEmpty()) return;
        // Park every page on a temporary key first: a page's final key can equal a
        // sibling's current key, and idx_documents_space_sibling_order_key_unique rejects
        // that transient state whatever order the flush happens to write rows in.
        for (int i = 0; i < siblings.size(); i++) {
            siblings.get(i).setSiblingOrderKey("~reindex-" + i);
        }
        documentRepository.flush();

        String[] newKeys = FractionalIndex.nKeysBetweenSpaced(null, null, siblings.size(), REINDEX_GAP);
        for (int i = 0; i < siblings.size(); i++) {
            siblings.get(i).setSiblingOrderKey(newKeys[i]);
        }
        documentRepository.flush();
    }

    private void reindexUserOrders(UUID userId) {
        List<UserDocumentOrder> orders = userDocumentOrderRepository.findAllForReindex(userId);
        if (orders.isEmpty()) return;
        // Same two passes as the sibling and space reindexes: a new key may still be held
        // by a row the pass has not reached yet, and idx_user_document_orders_user_order_key
        // is not deferrable.
        for (int i = 0; i < orders.size(); i++) {
            orders.get(i).setOrderKey("~reindex-" + i);
        }
        userDocumentOrderRepository.flush();

        String[] newKeys = FractionalIndex.nKeysBetweenSpaced(null, null, orders.size(), REINDEX_GAP);
        for (int i = 0; i < orders.size(); i++) {
            orders.get(i).setOrderKey(newKeys[i]);
        }
        userDocumentOrderRepository.flush();
    }

    private String nextFreeOrderKey(UUID userId, String minKey) {
        String candidate = FractionalIndex.keyBetween(null, minKey);
        while (userDocumentOrderRepository.existsByUser_IdAndOrderKey(userId, candidate)) {
            candidate = FractionalIndex.keyBetween(null, candidate);
        }
        return candidate;
    }

    private void ensureCollaboratorRootOrder(Document doc, AccessGrant grant) {
        if (grant.getEffect() != AccessGrantEffect.ALLOW) {
            return;
        }
        sharedSectionService.ensureOrderRow(grant.getUser(), doc);
    }

    private String resolveSiblingNeighborKey(UUID siblingId, UUID excludedDocId, UUID expectedParentId) {
        if (siblingId == null) return null;
        if (siblingId.equals(excludedDocId)) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "A document cannot be its own sibling reference.");
        }
        Document sibling = documentRepository
                .findByIdAndDeletedAtIsNull(siblingId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Sibling document not found: " + siblingId));
        if (expectedParentId != null) {
            if (sibling.getParent() == null
                    || !expectedParentId.equals(sibling.getParent().getId())) {
                throw new ApiException(
                        ErrorCode.VALIDATION_FAILED,
                        "Sibling document does not belong to the specified parent: " + siblingId);
            }
        } else if (sibling.getParent() != null) {
            throw new ApiException(
                    ErrorCode.VALIDATION_FAILED,
                    "Sibling document does not belong to the specified parent: " + siblingId);
        }
        return sibling.getSiblingOrderKey();
    }

    private String resolveSpaceSiblingNeighborKey(UUID siblingId, UUID excludedDocId, UUID spaceId) {
        if (siblingId == null) return null;
        if (siblingId.equals(excludedDocId)) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "A document cannot be its own sibling reference.");
        }
        Document sibling = documentRepository
                .findByIdAndDeletedAtIsNull(siblingId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Sibling document not found: " + siblingId));
        if (sibling.getParent() != null
                || sibling.getSpace() == null
                || !sibling.getSpace().getId().equals(spaceId)) {
            throw new ApiException(
                    ErrorCode.VALIDATION_FAILED,
                    "Sibling document does not belong to the specified space: " + siblingId);
        }
        return sibling.getSiblingOrderKey();
    }

    private String resolveUserNeighborKey(UUID userId, UUID siblingId, UUID excludedDocId) {
        if (siblingId == null) return null;
        if (siblingId.equals(excludedDocId)) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "A document cannot be its own sibling reference.");
        }
        Document sibling = documentRepository
                .findByIdAndDeletedAtIsNull(siblingId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Sibling document not found: " + siblingId));
        // Private holds only the caller's own roots: a readable page someone else can see
        // is a Shared entry, so a Private row for it would reopen the invariant V44's
        // migration establishes. Answer a page the caller cannot read as missing before
        // naming the namespace, so a stranger's nested page is not confirmed either.
        if (permissionService.resolveAccess(userId, siblingId) == null) {
            throw new ApiException(ErrorCode.NOT_FOUND, "Sibling document not found: " + siblingId);
        }
        // A nested page is never a root-navigation neighbour.
        if (sibling.getParent() != null) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "sibling does not belong to root navigation");
        }
        if (sharedSectionService.isInSection(userId, siblingId)) {
            throw new ApiException(
                    ErrorCode.VALIDATION_FAILED, "Sibling document is not part of the Private section: " + siblingId);
        }
        return userDocumentOrderRepository
                .findOrderKeyByUserIdAndDocumentId(userId, siblingId)
                .orElseGet(() -> ensureUserOrderKey(userId, sibling));
    }

    private String ensureUserOrderKey(UUID userId, Document sibling) {
        User user = userRepository.findById(userId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
        String minKey = userDocumentOrderRepository
                .findMinOrderKeyByUserId(userId, sibling.getId())
                .filter(FractionalIndex::isValidOrderKey)
                .orElse(null);
        UserDocumentOrder udo = UserDocumentOrder.builder()
                .user(user)
                .document(sibling)
                .orderKey(nextFreeOrderKey(userId, minKey))
                .build();
        userDocumentOrderRepository.saveAndFlush(udo);
        return udo.getOrderKey();
    }

    /**
     * Rejects moves that would cycle the tree, and returns the new parent's root-to-node
     * chain length so the caller can cap the moved subtree's resulting depth without
     * re-walking those ancestors.
     */
    private int validateNoCycle(UUID documentId, UUID newParentId) {
        UUID cursor = newParentId;
        int depth = 0;
        while (cursor != null) {
            if (depth >= MAX_TREE_DEPTH) {
                throw new ApiException(
                        ErrorCode.VALIDATION_FAILED,
                        "Ancestor chain is too deep or contains a cycle exceeding maximum depth.");
            }
            if (cursor.equals(documentId)) {
                throw new ApiException(
                        ErrorCode.VALIDATION_FAILED, "Cannot move a document under one of its own descendants.");
            }
            Document ancestor =
                    documentRepository.findByIdAndDeletedAtIsNull(cursor).orElse(null);
            if (ancestor == null) break;
            cursor = ancestor.getParent() != null ? ancestor.getParent().getId() : null;
            depth++;
        }
        return depth;
    }

    /**
     * Enforces the shared nesting cap on moves: the moved document lands at 0-based depth
     * {@code newParentChainNodes}, so its subtree may extend at most {@code MAX_TREE_DEPTH
     * - 1 - newParentChainNodes} further levels. Walks down id-only with early exit, so a
     * shallow move pays one query per level it actually has.
     */
    private void validateSubtreeFitsDepth(UUID documentId, int newParentChainNodes) {
        int allowedHeight = MAX_TREE_DEPTH - 1 - newParentChainNodes;
        if (allowedHeight < 0) {
            throw tooDeep();
        }
        List<UUID> frontier = List.of(documentId);
        for (int level = 1; level <= allowedHeight + 1; level++) {
            List<UUID> children = documentRepository.findIdsByParent_IdIn(frontier);
            if (children.isEmpty()) {
                return;
            }
            if (level > allowedHeight) {
                throw tooDeep();
            }
            frontier = children;
        }
    }

    private static ApiException tooDeep() {
        return new ApiException(
                ErrorCode.VALIDATION_FAILED,
                "Documents cannot be nested more than " + MAX_TREE_DEPTH + " levels deep.");
    }
}
