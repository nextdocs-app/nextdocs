package com.nextdocs.api.document.service;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.dto.request.DocumentMoveRequest;
import com.nextdocs.api.document.dto.response.DocumentTreeNodeResponse;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.entity.DocumentCollaborator;
import com.nextdocs.api.document.entity.UserDocumentOrder;
import com.nextdocs.api.document.repository.DocumentCollaboratorRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.repository.UserDocumentOrderRepository;
import com.nextdocs.api.document.util.FractionalIndex;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Slf4j
@Service
@RequiredArgsConstructor
public class DocumentTreeService {

    private static final int MAX_MOVE_ATTEMPTS = 3;

    private static final int REINDEX_GAP = 8;

    private static final int MAX_TREE_DEPTH = 100;

    private final DocumentRepository documentRepository;
    private final DocumentCollaboratorRepository collaboratorRepository;
    private final UserDocumentOrderRepository userDocumentOrderRepository;
    private final UserRepository userRepository;
    private final PermissionService permissionService;

    @Autowired
    @Lazy
    private DocumentTreeService selfProxy;

    @Transactional(readOnly = true)
    public Page<DocumentTreeNodeResponse> getRootDocuments(UUID userId, Pageable pageable) {
        Page<Object[]> rows = documentRepository.findPrivateRootDocuments(userId, pageable);
        List<Document> docs =
                rows.getContent().stream().map(r -> (Document) r[0]).toList();
        if (docs.isEmpty()) {
            return Page.empty(pageable);
        }

        List<UUID> docIds = docs.stream().map(Document::getId).toList();
        Map<UUID, Long> childCounts = fetchChildCounts(docIds);

        List<DocumentTreeNodeResponse> nodes = rows.getContent().stream()
                .map(r -> {
                    Document doc = (Document) r[0];
                    String orderKey = (String) r[1];
                    boolean hasChildren = childCounts.getOrDefault(doc.getId(), 0L) > 0;
                    return new DocumentTreeNodeResponse(
                            doc.getId(),
                            doc.getTitle(),
                            null,
                            orderKey,
                            hasChildren,
                            DocumentAccessLevel.OWNER,
                            doc.getCreatedAt(),
                            doc.getUpdatedAt());
                })
                .toList();

        return new PageImpl<>(nodes, pageable, rows.getTotalElements());
    }

    @Transactional(readOnly = true)
    public Page<DocumentTreeNodeResponse> getSharedDocuments(UUID userId, Pageable pageable) {
        Page<Object[]> rows = documentRepository.findSharedRootDocuments(userId, pageable);
        List<Document> docs =
                rows.getContent().stream().map(r -> (Document) r[0]).toList();
        if (docs.isEmpty()) {
            return Page.empty(pageable);
        }

        List<UUID> docIds = docs.stream().map(Document::getId).toList();
        Map<UUID, Long> childCounts = fetchChildCounts(docIds);
        Map<UUID, DocumentAccessLevel> accessLevels = fetchAccessLevels(userId, docIds);

        List<DocumentTreeNodeResponse> nodes = rows.getContent().stream()
                .map(r -> {
                    Document doc = (Document) r[0];
                    String orderKey = (String) r[1];
                    boolean hasChildren = childCounts.getOrDefault(doc.getId(), 0L) > 0;
                    DocumentAccessLevel access = doc.getUser().getId().equals(userId)
                            ? DocumentAccessLevel.OWNER
                            : accessLevels.getOrDefault(doc.getId(), null);
                    UUID parentId = doc.getParent() != null ? doc.getParent().getId() : null;
                    return new DocumentTreeNodeResponse(
                            doc.getId(),
                            doc.getTitle(),
                            parentId,
                            orderKey,
                            hasChildren,
                            access,
                            doc.getCreatedAt(),
                            doc.getUpdatedAt());
                })
                .toList();

        return new PageImpl<>(nodes, pageable, rows.getTotalElements());
    }

    @Transactional(readOnly = true)
    public Page<DocumentTreeNodeResponse> getChildren(UUID userId, UUID parentId, Pageable pageable) {
        permissionService.requireReadAccess(userId, parentId);

        Pageable effectivePageable = pageable;
        if (effectivePageable == null) {
            effectivePageable = PageRequest.of(0, 50, Sort.by("siblingOrderKey"));
        } else if (effectivePageable.getSort().isUnsorted()) {
            effectivePageable = PageRequest.of(
                    effectivePageable.getPageNumber(),
                    effectivePageable.getPageSize(),
                    Sort.by(Sort.Order.asc("siblingOrderKey"), Sort.Order.asc("id")));
        }
        Page<Document> page = documentRepository.findAllByParent_IdAndDeletedAtIsNull(parentId, effectivePageable);

        List<UUID> ids = page.getContent().stream().map(Document::getId).toList();
        if (ids.isEmpty()) {
            return Page.empty(pageable);
        }

        Map<UUID, Long> childCounts = fetchChildCounts(ids);
        Map<UUID, DocumentAccessLevel> accessLevels = fetchAccessLevels(userId, ids);

        return page.map(doc -> new DocumentTreeNodeResponse(
                doc.getId(),
                doc.getTitle(),
                parentId,
                doc.getSiblingOrderKey(),
                childCounts.getOrDefault(doc.getId(), 0L) > 0,
                accessLevels.getOrDefault(doc.getId(), null),
                doc.getCreatedAt(),
                doc.getUpdatedAt()));
    }

    public DocumentTreeNodeResponse move(UUID userId, UUID documentId, DocumentMoveRequest request) {
        int attempt = 0;
        while (true) {
            try {
                return selfProxy != null
                        ? selfProxy.moveAndPersist(userId, documentId, request, attempt > 0)
                        : moveAndPersist(userId, documentId, request, attempt > 0);
            } catch (DataIntegrityViolationException ex) {
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
    public DocumentTreeNodeResponse moveAndPersist(
            UUID userId, UUID documentId, DocumentMoveRequest request, boolean rebuildFirst) {
        Document doc;
        if (request.newParentId() != null) {
            doc = permissionService.requireEditAccess(userId, documentId);
            validateNoCycle(documentId, request.newParentId());
            Document newParent = permissionService.requireEditAccess(userId, request.newParentId());

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
            // Location authority: a subtree grafted into another user's tree joins that
            // tree - the host becomes the owner of the moved document and everything
            // beneath it, so access keeps flowing from the new parent chain.
            User previousOwner = doc.getUser();
            if (!newParent.getUser().getId().equals(doc.getUser().getId())) {
                adoptHostTreeOwnership(doc, newParent.getUser());
            }

            doc.setParent(newParent);
            doc.setSiblingOrderKey(newSiblingOrderKey);
            Document saved = documentRepository.saveAndFlush(doc);

            // Reparenting to a new parent: delete the owner's root UserDocumentOrder row.
            // Collaborators' UserDocumentOrder rows MUST NOT be wiped, because direct
            // collaborators still see this document floated in their Shared section.
            userDocumentOrderRepository.deleteByUser_IdAndDocument_Id(
                    newParent.getUser().getId(), documentId);
            if (!previousOwner.getId().equals(newParent.getUser().getId())) {
                userDocumentOrderRepository.deleteByUser_IdAndDocument_Id(previousOwner.getId(), documentId);
            }

            boolean hasChildren = documentRepository.existsNonTrashedChildrenByParentId(documentId);
            DocumentAccessLevel access = permissionService.resolveAccess(userId, documentId);
            return new DocumentTreeNodeResponse(
                    saved.getId(),
                    saved.getTitle(),
                    newParent.getId(),
                    newSiblingOrderKey,
                    hasChildren,
                    access,
                    saved.getCreatedAt(),
                    saved.getUpdatedAt());
        } else {
            // Root-level move or personal Shared section reordering
            Document targetDoc = documentRepository
                    .findByIdAndDeletedAtIsNull(documentId)
                    .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
            if (targetDoc.getUser().getId().equals(userId)) {
                permissionService.requireEditAccess(userId, documentId);
            } else {
                permissionService.requireReadAccess(userId, documentId);
            }
            doc = targetDoc;

            if (rebuildFirst) {
                reindexUserOrders(userId);
            }

            String prevKey = resolveUserNeighborKey(userId, request.prevSiblingId(), documentId);
            String nextKey = resolveUserNeighborKey(userId, request.nextSiblingId(), documentId);

            if (prevKey != null && nextKey != null && prevKey.compareTo(nextKey) > 0) {
                String lower = prevKey;
                prevKey = nextKey;
                nextKey = lower;
            }

            if (prevKey != null && !FractionalIndex.isValidOrderKey(prevKey)
                    || nextKey != null && !FractionalIndex.isValidOrderKey(nextKey)
                    || prevKey != null && prevKey.equals(nextKey)) {
                reindexUserOrders(userId);
                prevKey = resolveUserNeighborKey(userId, request.prevSiblingId(), documentId);
                nextKey = resolveUserNeighborKey(userId, request.nextSiblingId(), documentId);

                if (prevKey != null && nextKey != null && prevKey.compareTo(nextKey) > 0) {
                    String lower = prevKey;
                    prevKey = nextKey;
                    nextKey = lower;
                }
            }

            if (prevKey == null && nextKey == null) {
                prevKey = userDocumentOrderRepository
                        .findMaxOrderKeyByUserId(userId, documentId)
                        .filter(FractionalIndex::isValidOrderKey)
                        .orElse(null);
            }

            // The requested prev/next siblings are only adjacent in the frontend's
            // section (Private or Shared); the shared user_document_orders key space
            // is interleaved across both sections. So the new key must be computed
            // against the actual adjacent keys in that shared space, otherwise it can
            // collide with a document that lives between the two requested siblings.
            String newUserOrderKey;
            try {
                if (prevKey != null) {
                    String actualSucc = userDocumentOrderRepository
                            .findMinOrderKeyGreaterThan(userId, prevKey, documentId)
                            .filter(FractionalIndex::isValidOrderKey)
                            .orElse(null);
                    newUserOrderKey = FractionalIndex.keyBetween(prevKey, actualSucc);
                } else if (nextKey != null) {
                    String actualPred = userDocumentOrderRepository
                            .findMaxOrderKeyLessThan(userId, nextKey, documentId)
                            .filter(FractionalIndex::isValidOrderKey)
                            .orElse(null);
                    newUserOrderKey = FractionalIndex.keyBetween(actualPred, nextKey);
                } else {
                    String maxKey = userDocumentOrderRepository
                            .findMaxOrderKeyByUserId(userId, documentId)
                            .filter(FractionalIndex::isValidOrderKey)
                            .orElse(null);
                    newUserOrderKey = FractionalIndex.keyBetween(maxKey, null);
                }
            } catch (IllegalArgumentException ex) {
                log.warn("Invalid user order key interval: prevKey={} nextKey={}", prevKey, nextKey, ex);
                throw new ApiException(ErrorCode.CONFLICT, "The position changed concurrently. Please retry.");
            }

            if (doc.getParent() != null) {
                if (doc.getUser().getId().equals(userId)) {
                    // Owner: this is a private-tree move to the root level, so un-parent.
                    doc.setParent(null);
                    doc.setSiblingOrderKey(null);
                    documentRepository.saveAndFlush(doc);
                }
                // Collaborator: a nested shared document that appears at the root of
                // the Shared section is only being reordered in the caller's personal
                // navigation. The document stays under its real parent.
            }

            User user = userRepository.findById(userId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));

            UserDocumentOrder udo = userDocumentOrderRepository
                    .findByUser_IdAndDocument_Id(userId, documentId)
                    .orElseGet(() ->
                            UserDocumentOrder.builder().user(user).document(doc).build());
            udo.setOrderKey(newUserOrderKey);
            userDocumentOrderRepository.saveAndFlush(udo);

            for (DocumentCollaborator collaborator : collaboratorRepository.findAllByDocument_Id(documentId)) {
                ensureCollaboratorRootOrder(doc, collaborator);
            }

            boolean hasChildren = documentRepository.existsNonTrashedChildrenByParentId(documentId);
            DocumentAccessLevel access = doc.getUser().getId().equals(userId)
                    ? DocumentAccessLevel.OWNER
                    : permissionService.resolveAccess(userId, documentId);

            UUID resultParentId = doc.getParent() != null ? doc.getParent().getId() : null;

            return new DocumentTreeNodeResponse(
                    doc.getId(),
                    doc.getTitle(),
                    resultParentId,
                    newUserOrderKey,
                    hasChildren,
                    access,
                    doc.getCreatedAt(),
                    doc.getUpdatedAt());
        }
    }

    /**
     * Transfers ownership of a moved document and all of its descendants to the owner of
     * the destination tree, keeping the invariant child.user_id == parent.user_id so
     * ancestor-based access resolution stays authoritative.
     */
    private void adoptHostTreeOwnership(Document doc, User hostOwner) {
        doc.setUser(hostOwner);
        List<UUID> frontier = List.of(doc.getId());
        int depth = 0;
        while (!frontier.isEmpty()) {
            if (depth >= MAX_TREE_DEPTH) {
                // Mirrors the depth cap used elsewhere; cycles are prevented by move validation.
                throw new ApiException(ErrorCode.VALIDATION_FAILED, "Document tree is too deep or contains a cycle.");
            }
            List<Document> children = documentRepository.findAllByParent_IdIn(frontier);
            if (children.isEmpty()) {
                break;
            }
            for (Document child : children) {
                child.setUser(hostOwner);
            }
            documentRepository.saveAll(children);
            frontier = children.stream().map(Document::getId).toList();
            depth++;
        }
    }

    private void reindexSiblings(UUID parentId) {
        List<Document> siblings = documentRepository.findAllSiblingsForReindex(parentId);
        if (siblings.isEmpty()) return;
        String[] newKeys = FractionalIndex.nKeysBetweenSpaced(null, null, siblings.size(), REINDEX_GAP);
        for (int i = 0; i < siblings.size(); i++) {
            siblings.get(i).setSiblingOrderKey(newKeys[i]);
        }
        documentRepository.saveAll(siblings);
    }

    private void reindexUserOrders(UUID userId) {
        List<UserDocumentOrder> orders = userDocumentOrderRepository.findAllForReindex(userId);
        if (orders.isEmpty()) return;
        String[] newKeys = FractionalIndex.nKeysBetweenSpaced(null, null, orders.size(), REINDEX_GAP);
        for (int i = 0; i < orders.size(); i++) {
            orders.get(i).setOrderKey(newKeys[i]);
        }
        userDocumentOrderRepository.saveAll(orders);
    }

    private String nextFreeOrderKey(UUID userId, String minKey) {
        String candidate = FractionalIndex.keyBetween(null, minKey);
        while (userDocumentOrderRepository.existsByUser_IdAndOrderKey(userId, candidate)) {
            candidate = FractionalIndex.keyBetween(null, candidate);
        }
        return candidate;
    }

    private void ensureCollaboratorRootOrder(Document doc, DocumentCollaborator collaborator) {
        UUID collaboratorId = collaborator.getUser().getId();
        if (userDocumentOrderRepository.existsByUser_IdAndDocument_Id(collaboratorId, doc.getId())) {
            return;
        }
        String minKey = userDocumentOrderRepository
                .findMinOrderKeyByUserId(collaboratorId, doc.getId())
                .filter(FractionalIndex::isValidOrderKey)
                .orElse(null);
        UserDocumentOrder cudo = UserDocumentOrder.builder()
                .user(collaborator.getUser())
                .document(doc)
                .orderKey(nextFreeOrderKey(collaboratorId, minKey))
                .build();
        userDocumentOrderRepository.saveAndFlush(cudo);
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

    private String resolveUserNeighborKey(UUID userId, UUID siblingId, UUID excludedDocId) {
        if (siblingId == null) return null;
        if (siblingId.equals(excludedDocId)) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "A document cannot be its own sibling reference.");
        }
        Document sibling = documentRepository
                .findByIdAndDeletedAtIsNull(siblingId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Sibling document not found: " + siblingId));
        if (sibling.getUser().getId().equals(userId)) {
            if (sibling.getParent() != null) {
                throw new ApiException(ErrorCode.VALIDATION_FAILED, "sibling does not belong to root navigation");
            }
        } else {
            DocumentAccessLevel access = permissionService.resolveAccess(userId, siblingId);
            if (access == null) {
                throw new ApiException(ErrorCode.NOT_FOUND, "Sibling document not found: " + siblingId);
            }
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

    private void validateNoCycle(UUID documentId, UUID newParentId) {
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
    }

    private Map<UUID, Long> fetchChildCounts(List<UUID> docIds) {
        Map<UUID, Long> childCounts = new HashMap<>();
        for (Object[] row : documentRepository.countNonTrashedChildrenByParentIds(docIds)) {
            if (row[0] != null && row[1] != null) {
                UUID parentId = row[0] instanceof UUID u ? u : UUID.fromString(row[0].toString());
                long count = ((Number) row[1]).longValue();
                childCounts.put(parentId, count);
            }
        }
        return childCounts;
    }

    private Map<UUID, DocumentAccessLevel> fetchAccessLevels(UUID userId, List<UUID> docIds) {
        Map<UUID, DocumentAccessLevel> accessLevels = new HashMap<>();
        String joinedIds = docIds.stream().map(UUID::toString).collect(Collectors.joining(","));
        for (Object[] row : documentRepository.resolveEffectiveAccessBatch(userId, joinedIds)) {
            if (row[0] != null && row[1] != null) {
                UUID docId = row[0] instanceof UUID u ? u : UUID.fromString(row[0].toString());
                accessLevels.put(docId, DocumentAccessLevel.valueOf(row[1].toString()));
            }
        }
        return accessLevels;
    }
}
