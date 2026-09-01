package com.nextdocs.api.document.service;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.config.DocumentProperties;
import com.nextdocs.api.document.dto.request.DocumentCreateRequest;
import com.nextdocs.api.document.dto.request.DocumentUpdateRequest;
import com.nextdocs.api.document.dto.response.DocumentBreadcrumbResponse;
import com.nextdocs.api.document.dto.response.DocumentResponse;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.entity.DocumentCollaborator;
import com.nextdocs.api.document.entity.DocumentGeneralAccessMode;
import com.nextdocs.api.document.entity.UserDocumentOrder;
import com.nextdocs.api.document.repository.DocumentCollaboratorRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.repository.UserDocumentOrderRepository;
import com.nextdocs.api.document.util.FractionalIndex;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class DocumentService {

    public record CreateDocumentResult(DocumentResponse document, boolean created) {}

    private static final int MAX_CREATE_ATTEMPTS = 3;
    private static final int MAX_RESTORE_ATTEMPTS = 3;

    // Mirrors the depth cap of resolve_effective_access / resolve_trash_access in the DB.
    private static final int MAX_TREE_DEPTH = 100;

    private final DocumentRepository documentRepository;
    private final DocumentCollaboratorRepository collaboratorRepository;
    private final UserDocumentOrderRepository userDocumentOrderRepository;
    private final UserRepository userRepository;
    private final DocumentProperties documentProperties;
    private final PermissionService permissionService;
    private final DocumentListQueryHelper queryHelper;

    @Autowired
    @Lazy
    private DocumentService selfProxy;

    public CreateDocumentResult create(UUID userId, DocumentCreateRequest request) {
        int attempt = 0;
        while (true) {
            try {
                return selfProxy != null ? selfProxy.insertDocument(userId, request) : insertDocument(userId, request);
            } catch (DataIntegrityViolationException ex) {
                if (request.id() != null) {
                    Document existing =
                            documentRepository.findById(request.id()).orElse(null);
                    if (existing != null) {
                        return existingDocumentForCreate(existing, userId);
                    }
                }
                attempt++;
                if (attempt >= MAX_CREATE_ATTEMPTS) {
                    throw new ApiException(
                            ErrorCode.CONFLICT, "Could not assign a unique tree position. Please retry.");
                }
            }
        }
    }

    /**
     * Idempotent handling when a client-provided ID already exists. Nested documents belong
     * to their host tree's owner, so the original creator may no longer match user_id;
     * anyone who still holds access gets the existing document back, strangers get a conflict.
     */
    private CreateDocumentResult existingDocumentForCreate(Document existing, UUID userId) {
        if (existing.getDeletedAt() != null) {
            throw new ApiException(
                    ErrorCode.CONFLICT,
                    "A trashed document already exists with this ID. Restore or permanently delete it first.");
        }
        boolean isOwner = existing.getUser().getId().equals(userId);
        if (!isOwner && permissionService.resolveAccess(userId, existing.getId()) == null) {
            throw new ApiException(ErrorCode.CONFLICT, "A document already exists with this ID.");
        }
        return new CreateDocumentResult(toResponse(existing, true, userId), false);
    }

    @Transactional
    public CreateDocumentResult insertDocument(UUID userId, DocumentCreateRequest request) {
        User user = userRepository.findById(userId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
        String yjsState = request.yjsState();

        UUID documentId = request.id() != null ? request.id() : UUID.randomUUID();

        if (request.id() != null) {
            Document existing = documentRepository.findById(documentId).orElse(null);
            if (existing != null) {
                return existingDocumentForCreate(existing, userId);
            }
        }

        Document parent = null;
        String siblingOrderKey = null;
        if (request.parentId() != null) {
            parent = permissionService.requireEditAccess(userId, request.parentId());
            siblingOrderKey = resolveInitialSiblingOrderKey(
                    request.parentId(), request.prevSiblingId(), request.nextSiblingId(), documentId);
        }

        Document document = Document.builder()
                .id(documentId)
                // Location authority: a nested document belongs to its host tree, so it
                // inherits the parent's owner and, through ancestor resolution, the parent's
                // access chain. The creator is recorded in `createdBy`.
                .user(parent != null ? parent.getUser() : user)
                .title(normalizeTitle(request.title()))
                .yjsState(decodeBase64State(yjsState))
                .createdBy(request.createdBy())
                .parent(parent)
                .siblingOrderKey(siblingOrderKey)
                .build();

        Document saved = documentRepository.saveAndFlush(document);

        if (parent == null) {
            String userOrderKey =
                    resolveInitialUserOrderKey(userId, request.prevSiblingId(), request.nextSiblingId(), documentId);
            UserDocumentOrder udo = UserDocumentOrder.builder()
                    .user(user)
                    .document(saved)
                    .orderKey(userOrderKey)
                    .build();
            userDocumentOrderRepository.saveAndFlush(udo);
        }

        return new CreateDocumentResult(toResponse(saved, true, userId), true);
    }

    @Transactional(readOnly = true)
    public Page<DocumentResponse> list(UUID userId, String parentId, String scope, Boolean trashed, Pageable pageable) {
        return queryHelper.list(userId, parentId, scope, trashed, pageable);
    }

    @Transactional(readOnly = true)
    public DocumentResponse get(UUID userId, UUID documentId, boolean includeTrashed) {
        Document document;
        if (includeTrashed) {
            document = documentRepository.findById(documentId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));

            if (document.getDeletedAt() != null) {
                // Document is in trash - readable (read-only) for anyone who held any
                // pre-trash access; restore/purge remain EDIT-gated elsewhere.
                DocumentAccessLevel access = permissionService.resolveTrashAccess(userId, documentId);
                if (access == null) {
                    throw new ApiException(ErrorCode.NOT_FOUND);
                }
            } else {
                // Active document - check if user has access
                DocumentAccessLevel access = permissionService.resolveAccess(userId, documentId);
                if (access == null) {
                    throw new ApiException(ErrorCode.NOT_FOUND);
                }
            }
        } else {
            document = permissionService.requireReadAccess(userId, documentId);
        }
        return toResponse(document, true, userId);
    }

    @Transactional(readOnly = true)
    public DocumentResponse getPublic(UUID documentId) {
        Document document = documentRepository
                .findByIdAndDeletedAtIsNull(documentId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));

        if (document.getGeneralAccessMode() != DocumentGeneralAccessMode.ANYONE_WITH_LINK) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }

        return toResponse(document, true);
    }

    @Transactional(readOnly = true)
    public List<DocumentBreadcrumbResponse> getBreadcrumbs(UUID userId, UUID documentId) {
        Document target =
                documentRepository.findById(documentId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
        DocumentAccessLevel targetAccess = target.getDeletedAt() != null
                ? permissionService.resolveTrashAccess(userId, documentId)
                : permissionService.resolveAccess(userId, documentId);
        if (targetAccess == null) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }

        List<DocumentBreadcrumbResponse> path = new ArrayList<>();
        Document current = target;
        int depth = 0;
        while (current != null && depth < MAX_TREE_DEPTH) {
            Document parent = current.getParent();
            UUID parentId = null;

            if (parent != null) {
                DocumentAccessLevel parentAccess = parent.getDeletedAt() != null
                        ? permissionService.resolveTrashAccess(userId, parent.getId())
                        : permissionService.resolveAccess(userId, parent.getId());
                if (parentAccess != null) {
                    parentId = parent.getId();
                }
            }

            // Document icon is reserved for future icon/cover support when introduced to the Document entity model
            path.add(new DocumentBreadcrumbResponse(
                    current.getId(), formatBreadcrumbTitle(current.getTitle()), null, parentId));

            if (parentId == null) {
                // Reached the top of the user's accessible hierarchy
                break;
            }

            current = parent;
            depth++;
        }
        Collections.reverse(path);
        return path;
    }

    @Transactional(readOnly = true)
    public List<DocumentBreadcrumbResponse> getPublicBreadcrumbs(UUID documentId) {
        Document target = documentRepository
                .findByIdAndDeletedAtIsNull(documentId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));

        if (target.getGeneralAccessMode() != DocumentGeneralAccessMode.ANYONE_WITH_LINK) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }

        List<DocumentBreadcrumbResponse> path = new ArrayList<>();
        Document current = target;
        int depth = 0;
        while (current != null && depth < MAX_TREE_DEPTH) {
            Document parent = current.getParent();
            UUID parentId = null;

            if (parent != null) {
                // For public access, the parent must also be non-trashed and shared as ANYONE_WITH_LINK.
                // If the parent is private/restricted or trashed, we stop here so public viewers cannot see private
                // parent titles.
                if (parent.getDeletedAt() == null
                        && parent.getGeneralAccessMode() == DocumentGeneralAccessMode.ANYONE_WITH_LINK) {
                    parentId = parent.getId();
                }
            }

            // Document icon is reserved for future icon/cover support when introduced to the Document entity model
            path.add(new DocumentBreadcrumbResponse(
                    current.getId(), formatBreadcrumbTitle(current.getTitle()), null, parentId));

            if (parentId == null) {
                // Reached the top of public access
                break;
            }

            current = parent;
            depth++;
        }
        Collections.reverse(path);
        return path;
    }

    @Transactional
    public DocumentResponse update(UUID userId, UUID documentId, DocumentUpdateRequest request) {
        Document document =
                documentRepository.findById(documentId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));

        if (document.getDeletedAt() != null) {
            // Users with any pre-trash access recognize the document; nobody may edit it in trash.
            if (permissionService.resolveTrashAccess(userId, documentId) != null) {
                throw new ApiException(ErrorCode.CONFLICT, "Cannot update a document in trash. Restore it first.");
            }
            throw new ApiException(ErrorCode.NOT_FOUND);
        }

        // Active document: require edit access
        DocumentAccessLevel access = permissionService.resolveAccess(userId, documentId);
        if (access == null) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
        if (!access.allowsEdit()) {
            throw new ApiException(ErrorCode.FORBIDDEN);
        }

        if (request.title() != null) {
            document.setTitle(normalizeTitle(request.title()));
        }

        if (request.yjsState() != null) {
            document.setYjsState(decodeBase64State(request.yjsState()));
        }

        if (request.createdBy() != null) {
            document.setCreatedBy(request.createdBy());
        }

        return toResponse(documentRepository.save(document), true, userId);
    }

    @Transactional
    public void delete(UUID userId, UUID documentId, boolean permanent) {
        if (permanent) {
            // Verify the explicit resource ID against the caller's permission chain before purging.
            Document document = permissionService.requireTrashEditAccess(userId, documentId);
            if (document.getDeletedAt() == null) {
                throw new ApiException(
                        ErrorCode.VALIDATION_FAILED,
                        "Permanent delete is only allowed for documents already in trash.");
            }
            if (document.getParent() != null && document.getParent().getDeletedAt() != null) {
                throw new ApiException(
                        ErrorCode.VALIDATION_FAILED,
                        "Cannot permanently delete a child of a trashed document directly. Delete the parent document instead.");
            }

            List<Document> descendants = collectAllDescendants(documentId);
            // Delete in reverse hierarchy order (leaves first)
            Collections.reverse(descendants);
            for (Document descendant : descendants) {
                collaboratorRepository.deleteByDocument_Id(descendant.getId());
                userDocumentOrderRepository.deleteByDocument_Id(descendant.getId());
                documentRepository.delete(descendant);
            }

            collaboratorRepository.deleteByDocument_Id(documentId);
            userDocumentOrderRepository.deleteByDocument_Id(documentId);
            documentRepository.delete(document);
            return;
        }

        Document document = permissionService.requireEditAccess(userId, documentId);
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        document.setDeletedAt(now);
        userDocumentOrderRepository.deleteByDocument_Id(documentId);
        documentRepository.save(document);

        // Cascade soft delete to all active descendants
        List<Document> descendants = collectAllDescendants(documentId);
        for (Document descendant : descendants) {
            if (descendant.getDeletedAt() == null) {
                descendant.setDeletedAt(now);
                userDocumentOrderRepository.deleteByDocument_Id(descendant.getId());
                documentRepository.save(descendant);
            }
        }
    }

    public DocumentResponse restore(UUID userId, UUID documentId) {
        int attempt = 0;
        while (true) {
            try {
                return selfProxy != null
                        ? selfProxy.restoreAndPersist(userId, documentId, attempt > 0)
                        : restoreAndPersist(userId, documentId, attempt > 0);
            } catch (DataIntegrityViolationException ex) {
                attempt++;
                if (attempt >= MAX_RESTORE_ATTEMPTS) {
                    throw new ApiException(
                            ErrorCode.CONFLICT, "Could not restore the document to a unique position. Please retry.");
                }
            }
        }
    }

    @Transactional
    public DocumentResponse restoreAndPersist(UUID userId, UUID documentId, boolean forceRegenerate) {
        Document document = permissionService.requireTrashEditAccess(userId, documentId);
        if (document.getDeletedAt() == null) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }

        if (document.getParent() != null && document.getParent().getDeletedAt() != null) {
            throw new ApiException(
                    ErrorCode.VALIDATION_FAILED,
                    "Cannot restore a child of a trashed document directly. Restore the parent document instead.");
        }

        document.setDeletedAt(null);

        if (document.getParent() != null) {
            if (forceRegenerate || !FractionalIndex.isValidOrderKey(document.getSiblingOrderKey())) {
                String maxKey = documentRepository
                        .findMaxSiblingOrderKey(document.getParent().getId(), document.getId())
                        .filter(FractionalIndex::isValidOrderKey)
                        .orElse(null);
                document.setSiblingOrderKey(FractionalIndex.keyBetween(maxKey, null));
            }
        } else {
            UUID ownerId = document.getUser().getId();
            java.util.Optional<UserDocumentOrder> existingOpt =
                    userDocumentOrderRepository.findByUser_IdAndDocument_Id(ownerId, documentId);
            String existingKey = existingOpt.map(UserDocumentOrder::getOrderKey).orElse(null);
            boolean needsRegenerate =
                    forceRegenerate || existingOpt.isEmpty() || !FractionalIndex.isValidOrderKey(existingKey);
            if (needsRegenerate) {
                String maxKey = userDocumentOrderRepository
                        .findMaxOrderKeyByUserId(ownerId, documentId)
                        .filter(FractionalIndex::isValidOrderKey)
                        .orElse(null);
                String newKey = FractionalIndex.keyBetween(maxKey, null);
                UserDocumentOrder udo = existingOpt.orElseGet(() -> UserDocumentOrder.builder()
                        .user(document.getUser())
                        .document(document)
                        .build());
                udo.setOrderKey(newKey);
                userDocumentOrderRepository.saveAndFlush(udo);
            }

            for (DocumentCollaborator collaborator : collaboratorRepository.findAllByDocument_Id(documentId)) {
                ensureCollaboratorOrderRow(document, collaborator);
            }
        }

        Document savedRoot = documentRepository.saveAndFlush(document);

        // Restore all descendants that were in trash
        List<Document> descendants = collectAllDescendants(documentId);
        for (Document descendant : descendants) {
            if (descendant.getDeletedAt() != null) {
                descendant.setDeletedAt(null);
                if (!FractionalIndex.isValidOrderKey(descendant.getSiblingOrderKey())) {
                    String maxKey = documentRepository
                            .findMaxSiblingOrderKey(descendant.getParent().getId(), descendant.getId())
                            .filter(FractionalIndex::isValidOrderKey)
                            .orElse(null);
                    descendant.setSiblingOrderKey(FractionalIndex.keyBetween(maxKey, null));
                }
                documentRepository.saveAndFlush(descendant);

                // Soft delete wiped every user's ordering rows; give collaborators of
                // restored descendants back a row so their Shared-section placement survives.
                for (DocumentCollaborator collaborator :
                        collaboratorRepository.findAllByDocument_Id(descendant.getId())) {
                    ensureCollaboratorOrderRow(descendant, collaborator);
                }
            }
        }

        return toResponse(savedRoot, true, userId);
    }

    @Transactional
    public int purgeExpiredTrash(OffsetDateTime asOfUtc) {
        int days = documentProperties.getTrashRetentionDays();
        OffsetDateTime cutoff = asOfUtc.minusDays(days);
        return documentRepository.deleteExpiredTrash(cutoff);
    }

    public int purgeExpiredTrash() {
        OffsetDateTime nowUtc = OffsetDateTime.now(ZoneOffset.UTC);
        if (selfProxy != null) {
            return selfProxy.purgeExpiredTrash(nowUtc);
        }
        return purgeExpiredTrash(nowUtc);
    }

    private static String normalizeTitle(String title) {
        String value = title == null ? "" : title.strip();
        if (value.isBlank()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Title must not be blank.");
        }
        return value;
    }

    private static String formatBreadcrumbTitle(String title) {
        return (title == null || title.isBlank()) ? "Untitled" : title.strip();
    }

    private static byte[] decodeBase64State(String yjsState) {
        if (yjsState == null) {
            return null;
        }

        try {
            return Base64.getDecoder().decode(yjsState);
        } catch (IllegalArgumentException ex) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "yjsState must be valid base64.");
        }
    }

    private DocumentResponse toResponse(Document document, boolean includeState) {
        return toResponse(document, includeState, null);
    }

    /**
     * Converts a single Document entity to DocumentResponse DTO.
     * Note: This method accesses document.getParent() lazily and makes individual permission checks,
     * so it MUST be executed within an active @Transactional context. It is intended solely for
     * single-document operations (create, get, update, reorder); batch listings must use batch queries
     * via DocumentListQueryHelper instead.
     */
    private DocumentResponse toResponse(Document document, boolean includeState, UUID callerUserId) {
        OffsetDateTime deletedAt = document.getDeletedAt();
        OffsetDateTime purgeAt = null;
        if (deletedAt != null) {
            purgeAt = deletedAt.plusDays(documentProperties.getTrashRetentionDays());
        }

        String orderKey;
        if (callerUserId != null && !document.getUser().getId().equals(callerUserId)) {
            boolean isFloatedOrRoot;
            if (document.getParent() == null) {
                isFloatedOrRoot = true;
            } else {
                DocumentAccessLevel parentAccess =
                        (document.getParent().getDeletedAt() != null || document.getDeletedAt() != null)
                                ? permissionService.resolveTrashAccess(
                                        callerUserId, document.getParent().getId())
                                : permissionService.resolveAccess(
                                        callerUserId, document.getParent().getId());
                isFloatedOrRoot = (parentAccess == null);
            }
            if (isFloatedOrRoot) {
                orderKey = userDocumentOrderRepository
                        .findOrderKeyByUserIdAndDocumentId(callerUserId, document.getId())
                        .orElse(null);
            } else {
                orderKey = document.getSiblingOrderKey();
            }
        } else if (document.getParent() != null) {
            orderKey = document.getSiblingOrderKey();
        } else if (callerUserId != null) {
            orderKey = userDocumentOrderRepository
                    .findOrderKeyByUserIdAndDocumentId(callerUserId, document.getId())
                    .orElse(null);
        } else {
            orderKey = null;
        }

        boolean hasChildren = documentRepository.existsNonTrashedChildrenByParentId(document.getId());
        boolean hasCollaborators = collaboratorRepository.existsByDocument_Id(document.getId());
        DocumentAccessLevel accessLevel;
        if (callerUserId == null) {
            accessLevel = DocumentAccessLevel.VIEW;
        } else if (document.getUser().getId().equals(callerUserId)) {
            accessLevel = DocumentAccessLevel.OWNER;
        } else if (document.getDeletedAt() != null) {
            accessLevel = permissionService.resolveTrashAccess(callerUserId, document.getId());
        } else {
            accessLevel = permissionService.resolveAccess(callerUserId, document.getId());
        }

        return new DocumentResponse(
                document.getId(),
                document.getTitle(),
                includeState
                        ? (document.getYjsState() != null
                                ? Base64.getEncoder().encodeToString(document.getYjsState())
                                : null)
                        : null,
                document.getParent() != null ? document.getParent().getId() : null,
                orderKey,
                hasChildren,
                hasCollaborators,
                accessLevel,
                document.getCreatedBy(),
                document.getCreatedAt(),
                document.getUpdatedAt(),
                deletedAt,
                purgeAt);
    }

    private List<Document> collectAllDescendants(UUID rootId) {
        List<Document> allDescendants = new ArrayList<>();
        List<UUID> currentParentIds = List.of(rootId);
        int depth = 0;
        while (!currentParentIds.isEmpty()) {
            if (depth >= MAX_TREE_DEPTH) {
                // Cycles are prevented by move validation, but concurrent moves could race past
                // the check-then-act window. Bail out instead of looping forever.
                throw new ApiException(ErrorCode.VALIDATION_FAILED, "Document tree is too deep or contains a cycle.");
            }
            List<Document> children = documentRepository.findAllByParent_IdIn(currentParentIds);
            if (children.isEmpty()) {
                break;
            }
            allDescendants.addAll(children);
            currentParentIds = children.stream().map(Document::getId).toList();
            depth++;
        }
        return allDescendants;
    }

    private void ensureCollaboratorOrderRow(Document document, DocumentCollaborator collaborator) {
        UUID collaboratorId = collaborator.getUser().getId();
        if (userDocumentOrderRepository.existsByUser_IdAndDocument_Id(collaboratorId, document.getId())) {
            return;
        }
        String minKey = userDocumentOrderRepository
                .findMinOrderKeyByUserId(collaboratorId, document.getId())
                .filter(FractionalIndex::isValidOrderKey)
                .orElse(null);
        UserDocumentOrder cudo = UserDocumentOrder.builder()
                .user(collaborator.getUser())
                .document(document)
                .orderKey(FractionalIndex.keyBetween(null, minKey))
                .build();
        userDocumentOrderRepository.saveAndFlush(cudo);
    }

    private String resolveInitialSiblingOrderKey(UUID parentId, UUID prevSiblingId, UUID nextSiblingId, UUID selfId) {
        String prevKey = null;
        if (prevSiblingId != null) {
            Document prevDoc = documentRepository
                    .findByIdAndDeletedAtIsNull(prevSiblingId)
                    .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "prevSiblingId not found."));
            if (prevDoc.getParent() == null || !prevDoc.getParent().getId().equals(parentId)) {
                throw new ApiException(
                        ErrorCode.VALIDATION_FAILED, "prevSiblingId does not belong to the specified parent.");
            }
            String rawPrev = prevDoc.getSiblingOrderKey();
            if (rawPrev == null || !FractionalIndex.isValidOrderKey(rawPrev)) {
                throw new ApiException(
                        ErrorCode.VALIDATION_FAILED, "prevSiblingId has an invalid order key; reindex required.");
            }
            prevKey = rawPrev;
        }

        String nextKey = null;
        if (nextSiblingId != null) {
            Document nextDoc = documentRepository
                    .findByIdAndDeletedAtIsNull(nextSiblingId)
                    .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "nextSiblingId not found."));
            if (nextDoc.getParent() == null || !nextDoc.getParent().getId().equals(parentId)) {
                throw new ApiException(
                        ErrorCode.VALIDATION_FAILED, "nextSiblingId does not belong to the specified parent.");
            }
            String rawNext = nextDoc.getSiblingOrderKey();
            if (rawNext == null || !FractionalIndex.isValidOrderKey(rawNext)) {
                throw new ApiException(
                        ErrorCode.VALIDATION_FAILED, "nextSiblingId has an invalid order key; reindex required.");
            }
            nextKey = rawNext;
        }

        if (prevKey != null && nextKey != null) {
            if (prevKey.compareTo(nextKey) > 0) {
                String temp = prevKey;
                prevKey = nextKey;
                nextKey = temp;
            } else if (prevKey.equals(nextKey)) {
                throw new ApiException(ErrorCode.CONFLICT, "Sibling order keys are identical. Please retry.");
            }
        }

        if (prevKey == null && nextKey == null) {
            String minKey = documentRepository
                    .findMinSiblingOrderKey(parentId, selfId)
                    .filter(FractionalIndex::isValidOrderKey)
                    .orElse(null);
            return FractionalIndex.keyBetween(null, minKey);
        }

        try {
            return FractionalIndex.keyBetween(prevKey, nextKey);
        } catch (IllegalArgumentException ex) {
            throw new ApiException(ErrorCode.CONFLICT, "The sibling ordering has changed concurrently. Please retry.");
        }
    }

    private String resolveInitialUserOrderKey(UUID userId, UUID prevSiblingId, UUID nextSiblingId, UUID selfId) {
        String prevKey = null;
        if (prevSiblingId != null) {
            documentRepository
                    .findByIdAndDeletedAtIsNull(prevSiblingId)
                    .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "prevSiblingId not found."));
            String rawPrev = userDocumentOrderRepository
                    .findOrderKeyByUserIdAndDocumentId(userId, prevSiblingId)
                    .orElseThrow(() -> new ApiException(
                            ErrorCode.VALIDATION_FAILED, "sibling does not belong to root navigation"));
            if (!FractionalIndex.isValidOrderKey(rawPrev)) {
                throw new ApiException(
                        ErrorCode.VALIDATION_FAILED, "prevSiblingId has an invalid order key; reindex required.");
            }
            prevKey = rawPrev;
        }

        String nextKey = null;
        if (nextSiblingId != null) {
            documentRepository
                    .findByIdAndDeletedAtIsNull(nextSiblingId)
                    .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "nextSiblingId not found."));
            String rawNext = userDocumentOrderRepository
                    .findOrderKeyByUserIdAndDocumentId(userId, nextSiblingId)
                    .orElseThrow(() -> new ApiException(
                            ErrorCode.VALIDATION_FAILED, "sibling does not belong to root navigation"));
            if (!FractionalIndex.isValidOrderKey(rawNext)) {
                throw new ApiException(
                        ErrorCode.VALIDATION_FAILED, "nextSiblingId has an invalid order key; reindex required.");
            }
            nextKey = rawNext;
        }

        if (prevKey != null && nextKey != null) {
            if (prevKey.compareTo(nextKey) > 0) {
                String temp = prevKey;
                prevKey = nextKey;
                nextKey = temp;
            } else if (prevKey.equals(nextKey)) {
                throw new ApiException(ErrorCode.CONFLICT, "Sibling order keys are identical. Please retry.");
            }
        }

        if (prevKey == null && nextKey == null) {
            String minKey = userDocumentOrderRepository
                    .findMinOrderKeyByUserId(userId, selfId)
                    .filter(FractionalIndex::isValidOrderKey)
                    .orElse(null);
            return FractionalIndex.keyBetween(null, minKey);
        }

        try {
            return FractionalIndex.keyBetween(prevKey, nextKey);
        } catch (IllegalArgumentException ex) {
            throw new ApiException(ErrorCode.CONFLICT, "The sibling ordering has changed concurrently. Please retry.");
        }
    }
}
