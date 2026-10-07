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
import com.nextdocs.api.document.entity.UserDocumentOrder;
import com.nextdocs.api.document.repository.DocumentCollaboratorRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.repository.UserDocumentOrderRepository;
import com.nextdocs.api.document.util.FractionalIndex;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
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

    // Anonymous public child listings fan out to per-row resolve_public_access CTEs;
    // an unauthenticated caller must not be able to ask for thousands of rows per request.
    static final int MAX_PUBLIC_CHILDREN_PAGE_SIZE = 50;

    // Anonymous saves share a per-IP budget of 20 requests/min, and the realtime
    // layer refuses payloads above 5 MB, so an unbounded snapshot write can only
    // burn bandwidth and storage on data that could never sync.
    static final int MAX_PUBLIC_STATE_BYTES = 5 * 1024 * 1024;

    // Mirrors documents.title VARCHAR(255) in V2 and the DTOs' @Size bound.
    static final int MAX_TITLE_LENGTH = 255;

    // Base64 turns 3 bytes into 4 characters, so this bounds what a caller can make the
    // decoder allocate. Deliberately a little generous (the 3-byte encoding quantum
    // hides up to two extra bytes) and only a pre-filter: MAX_PUBLIC_STATE_BYTES stays
    // the exact rule. Rejecting on length first means an unauthenticated caller cannot
    // make the API materialise an arbitrarily large snapshot before the size check.
    static final int MAX_PUBLIC_STATE_ENCODED_LENGTH = ((MAX_PUBLIC_STATE_BYTES + 2) / 3) * 4 + 4;

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

        DocumentAccessLevel publicAccess = permissionService.resolvePublicAccess(documentId);
        if (publicAccess == null) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }

        return toResponse(document, true, null, publicAccess);
    }

    @Transactional(readOnly = true)
    public Page<DocumentResponse> listPublicChildren(UUID parentId, Pageable pageable) {
        Document parent = documentRepository
                .findByIdAndDeletedAtIsNull(parentId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));

        if (permissionService.resolvePublicAccess(parentId) == null) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }

        Pageable clampedPageable = clampPageSize(pageable, MAX_PUBLIC_CHILDREN_PAGE_SIZE);
        Page<Document> page = documentRepository.findPublicChildren(parent.getId(), clampedPageable);
        if (page.isEmpty()) {
            return Page.empty(clampedPageable);
        }

        List<Document> children = page.getContent();
        List<UUID> childIds = children.stream().map(Document::getId).toList();

        Map<UUID, Long> childCounts = fetchPublicChildCounts(childIds);
        Map<UUID, DocumentAccessLevel> accessLevels = permissionService.resolvePublicAccessBatch(childIds);
        // Parent links in one query instead of one lazy select per child.
        Map<UUID, UUID> parentById = new HashMap<>();
        for (Object[] row : documentRepository.findParentIdsByIdIn(childIds)) {
            Object rawParent = row[1];
            parentById.put(
                    (UUID) row[0],
                    rawParent instanceof UUID u
                            ? u
                            : (rawParent != null ? UUID.fromString(rawParent.toString()) : null));
        }

        return page.map(child -> {
            boolean hasChildren = childCounts.getOrDefault(child.getId(), 0L) > 0;
            boolean hasCollaborators = false;
            DocumentAccessLevel accessLevel = accessLevels.get(child.getId());
            OffsetDateTime deletedAt = child.getDeletedAt();
            OffsetDateTime purgeAt =
                    deletedAt != null ? deletedAt.plusDays(documentProperties.getTrashRetentionDays()) : null;

            return new DocumentResponse(
                    child.getId(),
                    child.getTitle(),
                    null,
                    parentById.getOrDefault(child.getId(), parentId),
                    child.getSiblingOrderKey(),
                    hasChildren,
                    hasCollaborators,
                    accessLevel,
                    child.getCreatedBy(),
                    child.getCreatedAt(),
                    child.getUpdatedAt(),
                    deletedAt,
                    purgeAt);
        });
    }

    private Map<UUID, Long> fetchPublicChildCounts(Collection<UUID> docIds) {
        if (docIds.isEmpty()) return Map.of();
        Map<UUID, Long> childCounts = new HashMap<>();
        for (Object[] row : documentRepository.countPublicChildrenByParentIds(docIds)) {
            if (row[0] != null && row[1] != null) {
                UUID pId = row[0] instanceof UUID u ? u : UUID.fromString(row[0].toString());
                long count = ((Number) row[1]).longValue();
                childCounts.put(pId, count);
            }
        }
        return childCounts;
    }

    private static Pageable clampPageSize(Pageable pageable, int maxSize) {
        if (pageable == null) {
            return PageRequest.of(0, maxSize);
        }
        // PUBLIC_CHILDREN_SQL pins its own ORDER BY, so any client-supplied
        // sort must be dropped; native queries would otherwise apply it.
        return PageRequest.of(pageable.getPageNumber(), Math.min(pageable.getPageSize(), maxSize));
    }

    private Map<UUID, Long> fetchChildCounts(Collection<UUID> docIds) {
        if (docIds.isEmpty()) return Map.of();
        Map<UUID, Long> childCounts = new HashMap<>();
        for (Object[] row : documentRepository.countNonTrashedChildrenByParentIds(docIds)) {
            if (row[0] != null && row[1] != null) {
                UUID pId = row[0] instanceof UUID u ? u : UUID.fromString(row[0].toString());
                long count = ((Number) row[1]).longValue();
                childCounts.put(pId, count);
            }
        }
        return childCounts;
    }

    /**
     * Anonymous snapshot save for share links. Anyone holding a link whose effective
     * (possibly inherited) access allows editing may persist title/content without
     * signing in — the link UUID itself is the capability, like polished
     * self-hostable docs (Docmost/Outline public edit links). Comment-only and
     * view-only links cannot save snapshots here; comments still sync live over
     * the realtime channel where per-key write guards apply.
     */
    @Transactional
    public DocumentResponse updatePublic(UUID documentId, DocumentUpdateRequest request) {
        Document document = documentRepository
                .findByIdAndDeletedAtIsNull(documentId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));

        DocumentAccessLevel access = permissionService.resolvePublicAccess(documentId);
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
            if (request.yjsState().length() > MAX_PUBLIC_STATE_ENCODED_LENGTH) {
                throw publicStateTooLarge();
            }
            byte[] state = decodeBase64State(request.yjsState());
            if (state.length > MAX_PUBLIC_STATE_BYTES) {
                throw publicStateTooLarge();
            }
            document.setYjsState(state);
        }

        // The EDIT gate above already resolved the public level: reuse it instead
        // of resolving a second time inside toResponse.
        return toResponse(documentRepository.save(document), true, null, access);
    }

    @Transactional(readOnly = true)
    public List<DocumentBreadcrumbResponse> getBreadcrumbs(UUID userId, UUID documentId) {
        Document target =
                documentRepository.findById(documentId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
        DocumentAccessLevel currentAccess = target.getDeletedAt() != null
                ? permissionService.resolveTrashAccess(userId, documentId)
                : permissionService.resolveAccess(userId, documentId);
        if (currentAccess == null) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }

        // Fixed query count whatever the depth: one ancestor-chain query, one
        // entity load, and one access batch per scope (active/trash).
        List<UUID> chainIds = documentRepository.findAncestorChainIds(documentId);
        List<UUID> allIds = new ArrayList<>(chainIds.size() + 1);
        allIds.add(documentId);
        allIds.addAll(chainIds);
        Map<UUID, Document> docsById = new HashMap<>();
        for (Document doc : documentRepository.findAllById(allIds)) {
            docsById.put(doc.getId(), doc);
        }
        Map<UUID, DocumentAccessLevel> accessById = permissionService.resolveAccessBatch(userId, allIds);
        Map<UUID, DocumentAccessLevel> trashAccessById = permissionService.resolveTrashAccessBatch(userId, allIds);

        List<DocumentBreadcrumbResponse> path = new ArrayList<>();
        List<UUID> orderedIds = new ArrayList<>(allIds);
        int depth = 0;
        for (int i = 0; i < orderedIds.size(); i++) {
            UUID currentId = orderedIds.get(i);
            if (depth >= MAX_TREE_DEPTH) {
                break;
            }
            Document current = docsById.get(currentId);
            if (current == null) {
                break;
            }
            DocumentAccessLevel level =
                    current.getDeletedAt() != null ? trashAccessById.get(currentId) : accessById.get(currentId);
            if (level == null && !currentId.equals(documentId)) {
                break;
            }
            if (currentId.equals(documentId)) {
                level = currentAccess;
            }
            UUID parentId = null;
            int currentIndex = i;
            if (currentIndex + 1 < orderedIds.size()) {
                UUID candidateParentId = orderedIds.get(currentIndex + 1);
                Document candidateParent = docsById.get(candidateParentId);
                if (candidateParent != null) {
                    DocumentAccessLevel parentLevel = candidateParent.getDeletedAt() != null
                            ? trashAccessById.get(candidateParentId)
                            : accessById.get(candidateParentId);
                    if (parentLevel != null) {
                        parentId = candidateParentId;
                    }
                }
            }

            path.add(new DocumentBreadcrumbResponse(
                    current.getId(),
                    formatBreadcrumbTitle(current.getTitle()),
                    null,
                    parentId,
                    current.getSiblingOrderKey(),
                    level,
                    current.getCreatedAt(),
                    current.getUpdatedAt()));

            if (parentId == null) {
                break;
            }
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

        DocumentAccessLevel currentAccess = permissionService.resolvePublicAccess(documentId);
        if (currentAccess == null) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }

        List<UUID> chainIds = documentRepository.findAncestorChainIds(documentId);
        List<UUID> allIds = new ArrayList<>(chainIds.size() + 1);
        allIds.add(documentId);
        allIds.addAll(chainIds);
        Map<UUID, Document> docsById = new HashMap<>();
        for (Document doc : documentRepository.findAllById(allIds)) {
            if (doc.getDeletedAt() == null) {
                docsById.put(doc.getId(), doc);
            }
        }
        Map<UUID, DocumentAccessLevel> publicAccessById = permissionService.resolvePublicAccessBatch(allIds);

        List<DocumentBreadcrumbResponse> path = new ArrayList<>();
        int depth = 0;
        for (int i = 0; i < allIds.size(); i++) {
            UUID currentId = allIds.get(i);
            if (depth >= MAX_TREE_DEPTH) {
                break;
            }
            Document current = docsById.get(currentId);
            if (current == null) {
                break;
            }
            DocumentAccessLevel level = currentId.equals(documentId) ? currentAccess : publicAccessById.get(currentId);
            if (level == null) {
                break;
            }
            UUID parentId = null;
            int currentIndex = i;
            if (currentIndex + 1 < allIds.size()) {
                UUID candidateParentId = allIds.get(currentIndex + 1);
                if (publicAccessById.get(candidateParentId) != null && docsById.containsKey(candidateParentId)) {
                    parentId = candidateParentId;
                }
            }

            path.add(new DocumentBreadcrumbResponse(
                    current.getId(),
                    formatBreadcrumbTitle(current.getTitle()),
                    null,
                    parentId,
                    current.getSiblingOrderKey(),
                    level,
                    current.getCreatedAt(),
                    current.getUpdatedAt()));

            if (parentId == null) {
                break;
            }
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
            if (request.yjsState().length() > MAX_PUBLIC_STATE_ENCODED_LENGTH) {
                throw publicStateTooLarge();
            }
            byte[] state = decodeBase64State(request.yjsState());
            if (state.length > MAX_PUBLIC_STATE_BYTES) {
                throw publicStateTooLarge();
            }
            document.setYjsState(state);
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

    /**
     * Blank titles fall back to Untitled. Over-long titles are rejected here as well as at the
     * request boundary ({@code @Size}): the column is VARCHAR(255), so a title that slipped past
     * the DTO would otherwise surface as a 500 from the database instead of a validation error.
     */
    private static String normalizeTitle(String title) {
        String value = title == null ? "" : title.strip();
        if (value.isBlank()) {
            return "Untitled";
        }
        if (value.length() > MAX_TITLE_LENGTH) {
            throw new ApiException(
                    ErrorCode.VALIDATION_FAILED, "Title must be at most " + MAX_TITLE_LENGTH + " characters.");
        }
        return value;
    }

    private static String formatBreadcrumbTitle(String title) {
        return (title == null || title.isBlank()) ? "Untitled" : title.strip();
    }

    private static ApiException publicStateTooLarge() {
        return new ApiException(
                ErrorCode.VALIDATION_FAILED,
                "yjsState exceeds the maximum size of " + (MAX_PUBLIC_STATE_BYTES / (1024 * 1024)) + " MB.");
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
        return toResponse(document, includeState, null, null);
    }

    private DocumentResponse toResponse(Document document, boolean includeState, UUID callerUserId) {
        return toResponse(document, includeState, callerUserId, null);
    }

    /**
     * Converts a single Document entity to DocumentResponse DTO.
     * Note: This method accesses document.getParent() lazily and makes individual permission checks,
     * so it MUST be executed within an active @Transactional context. It is intended solely for
     * single-document operations (create, get, update, reorder); batch listings must use batch queries
     * via DocumentListQueryHelper instead.
     *
     * @param publicAccessHint already-resolved public level for anonymous single-document
     *     reads, so callers that resolved it for gating do not pay a second CTE.
     */
    private DocumentResponse toResponse(
            Document document, boolean includeState, UUID callerUserId, DocumentAccessLevel publicAccessHint) {
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

        boolean hasChildren = callerUserId == null
                // Share-link guests must not learn about children they cannot
                // open: filter by public readability like listPublicChildren
                // instead of counting every non-trashed child.
                ? !documentRepository
                        .countPublicChildrenByParentIds(List.of(document.getId()))
                        .isEmpty()
                : documentRepository.existsNonTrashedChildrenByParentId(document.getId());
        // Anonymous readers (share-link guests) must not learn whether a document has
        // collaborators: listPublicChildren answers false for the same reason, and only a
        // signed-in caller has a roster to compare the flag against.
        boolean hasCollaborators = callerUserId != null && collaboratorRepository.existsByDocument_Id(document.getId());
        DocumentAccessLevel accessLevel;
        if (callerUserId == null) {
            accessLevel = publicAccessHint != null
                    ? publicAccessHint
                    : permissionService.resolvePublicAccess(document.getId());
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
        if (collaborator.getAccessLevel() == DocumentAccessLevel.NO_ACCESS) {
            return;
        }
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
