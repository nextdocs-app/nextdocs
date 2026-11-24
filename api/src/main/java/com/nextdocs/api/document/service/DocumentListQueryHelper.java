package com.nextdocs.api.document.service;

import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.config.DocumentProperties;
import com.nextdocs.api.document.dto.response.DocumentResponse;
import com.nextdocs.api.document.dto.response.DocumentResponses;
import com.nextdocs.api.document.dto.response.SharedEntry;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.repository.AccessGrantRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.repository.UserDocumentOrderRepository;
import com.nextdocs.api.space.service.SpaceAccessService;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
@RequiredArgsConstructor
public class DocumentListQueryHelper {

    private final DocumentRepository documentRepository;
    private final AccessGrantRepository accessGrantRepository;
    private final UserDocumentOrderRepository userDocumentOrderRepository;
    private final SharedSectionService sharedSectionService;
    private final DocumentProperties documentProperties;
    private final PermissionService permissionService;
    private final SpaceAccessService spaceAccessService;

    private static final Set<String> KNOWN_SCOPES = Set.of("all", "private", "shared", "space");
    private static final Map<String, String> NATIVE_SORT_COLUMNS = Map.of(
            "updatedAt", "updated_at",
            "createdAt", "created_at",
            "title", "title",
            "siblingOrderKey", "sibling_order_key",
            "id", "id");

    @Transactional(readOnly = true)
    public Page<DocumentResponse> list(
            UUID userId, String parentId, String scope, Boolean trashed, String spaceId, Pageable pageable) {
        boolean trashedOnly = Boolean.TRUE.equals(trashed);
        boolean hasSpaceParam = spaceId != null && !spaceId.isBlank();
        String normalizedScope =
                scope != null && !scope.isBlank() ? scope.trim().toLowerCase() : "all";

        if (!KNOWN_SCOPES.contains(normalizedScope)) {
            throw new ApiException(
                    ErrorCode.VALIDATION_FAILED,
                    "Invalid scope value: " + scope + ". Must be 'private', 'shared', 'space', or 'all'.");
        }

        // scope=space is a root listing of one space, so the pairing is checked before
        // any query: a stray spaceId on another scope silently ignoring it would list the
        // wrong section, and a missing one would list every root page as if it were a space.
        if (hasSpaceParam && !"space".equals(normalizedScope)) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "spaceId is only valid with scope=space.");
        }
        if ("space".equals(normalizedScope) && !hasSpaceParam) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "spaceId is required when scope=space.");
        }

        if (trashedOnly) {
            if (parentId != null && !parentId.trim().isEmpty()) {
                throw new ApiException(ErrorCode.VALIDATION_FAILED, "parentId cannot be combined with trashed=true");
            }
            if (!"all".equals(normalizedScope)) {
                throw new ApiException(ErrorCode.VALIDATION_FAILED, "scope cannot be combined with trashed=true");
            }
            return listTrashed(userId, pageable);
        }

        if (parentId != null) {
            String trimmedParentId = parentId.trim();
            if ("root".equalsIgnoreCase(trimmedParentId)) {
                return listRootDocuments(userId, normalizedScope, spaceId, pageable);
            }

            return listChildDocuments(userId, trimmedParentId, normalizedScope, pageable);
        }

        if ("space".equals(normalizedScope)) {
            return listRootDocuments(userId, normalizedScope, spaceId, pageable);
        }

        return listFlatDocuments(userId, normalizedScope, pageable);
    }

    private Page<DocumentResponse> listTrashed(UUID userId, Pageable pageable) {
        Pageable effectivePageable = pageable;
        if (effectivePageable == null || effectivePageable.getSort().isUnsorted()) {
            Sort sort = Sort.by(Sort.Order.desc("deletedAt"), Sort.Order.asc("id"));
            effectivePageable = effectivePageable != null
                    ? PageRequest.of(effectivePageable.getPageNumber(), effectivePageable.getPageSize(), sort)
                    : PageRequest.of(0, 20, sort);
        }

        Page<Document> page = documentRepository.findAccessibleTrashedDocuments(userId, effectivePageable);
        List<Document> docs = page.getContent();
        if (docs.isEmpty()) {
            return new PageImpl<>(List.of(), effectivePageable, page.getTotalElements());
        }

        List<UUID> docIds = docs.stream().map(Document::getId).toList();
        Set<UUID> collaboratorDocIds = new HashSet<>(accessGrantRepository.findDocumentIdsWithPositiveGrants(docIds));
        Map<UUID, DocumentAccessLevel> trashAccessLevels = fetchTrashAccessLevels(userId, docIds);

        return page.map(doc -> {
            OffsetDateTime deletedAt = doc.getDeletedAt();
            OffsetDateTime purgeAt =
                    deletedAt != null ? deletedAt.plusDays(documentProperties.getTrashRetentionDays()) : null;
            DocumentAccessLevel access = trashAccessLevels.get(doc.getId());
            boolean hasCollaborators = collaboratorDocIds.contains(doc.getId());
            UUID parentDocId = doc.getParent() != null ? doc.getParent().getId() : null;

            return DocumentResponses.of(
                    doc, parentDocId, doc.getSiblingOrderKey(), false, hasCollaborators, access, deletedAt, purgeAt);
        });
    }

    private Page<DocumentResponse> listRootDocuments(UUID userId, String scope, String spaceId, Pageable pageable) {
        String normalizedScope =
                scope != null && !scope.isBlank() ? scope.trim().toLowerCase() : "all";

        if ("space".equals(normalizedScope)) {
            return listSpaceRootDocuments(userId, parseSpaceId(spaceId), pageable);
        }

        if ("shared".equals(normalizedScope)) {
            return listSharedSection(userId, pageable);
        }

        if ("all".equals(normalizedScope)) {
            Page<Object[]> rows = documentRepository.findAllRootDocuments(userId, pageable);
            List<Document> docs =
                    rows.getContent().stream().map(r -> (Document) r[0]).toList();
            if (docs.isEmpty()) {
                return new PageImpl<>(List.of(), pageable, rows.getTotalElements());
            }

            List<UUID> docIds = docs.stream().map(Document::getId).toList();
            Map<UUID, Long> childCounts = fetchChildCounts(docIds);
            Set<UUID> collaboratorDocIds =
                    new HashSet<>(accessGrantRepository.findDocumentIdsWithPositiveGrants(docIds));
            Map<UUID, DocumentAccessLevel> accessLevels = fetchAccessLevels(userId, docIds);

            List<DocumentResponse> responses = rows.getContent().stream()
                    .map(r -> {
                        Document doc = (Document) r[0];
                        String orderKey = (String) r[1];
                        boolean hasChildren = childCounts.getOrDefault(doc.getId(), 0L) > 0;
                        boolean hasCollaborators = collaboratorDocIds.contains(doc.getId());

                        return DocumentResponses.of(
                                doc,
                                null,
                                orderKey,
                                hasChildren,
                                hasCollaborators,
                                accessLevels.get(doc.getId()),
                                null,
                                null);
                    })
                    .toList();

            return new PageImpl<>(responses, pageable, rows.getTotalElements());
        }

        if ("private".equals(normalizedScope)) {
            Page<Object[]> rows = documentRepository.findPrivateRootDocuments(userId, pageable);
            List<Document> docs =
                    rows.getContent().stream().map(r -> (Document) r[0]).toList();
            if (docs.isEmpty()) {
                return new PageImpl<>(List.of(), pageable, rows.getTotalElements());
            }

            List<UUID> docIds = docs.stream().map(Document::getId).toList();
            Map<UUID, Long> childCounts = fetchChildCounts(docIds);

            List<DocumentResponse> responses = rows.getContent().stream()
                    .map(r -> {
                        Document doc = (Document) r[0];
                        String orderKey = (String) r[1];
                        boolean hasChildren = childCounts.getOrDefault(doc.getId(), 0L) > 0;

                        return DocumentResponses.of(
                                doc, null, orderKey, hasChildren, false, DocumentAccessLevel.OWNER, null, null);
                    })
                    .toList();

            return new PageImpl<>(responses, pageable, rows.getTotalElements());
        }

        throw new ApiException(
                ErrorCode.VALIDATION_FAILED,
                "Invalid scope value for root documents: " + scope
                        + ". Must be 'private', 'shared', 'space', or 'all'.");
    }

    /**
     * The signed-in Shared section. The service owns the single-home rule (including a
     * space root the caller cannot browse through its space) and the personal order;
     * this method only paginates and fills in the listing-only fields.
     */
    private Page<DocumentResponse> listSharedSection(UUID userId, Pageable pageable) {
        List<SharedEntry> entries = sharedSectionService.list(userId);
        if (entries.isEmpty()) {
            return new PageImpl<>(List.of(), pageable, 0);
        }

        int total = entries.size();
        List<SharedEntry> pageEntries = pageSlice(entries, pageable);
        if (pageEntries.isEmpty()) {
            return new PageImpl<>(List.of(), pageable, total);
        }

        List<UUID> ids = pageEntries.stream().map(SharedEntry::id).toList();
        Map<UUID, Document> documents = new HashMap<>();
        for (Document document : documentRepository.findAllById(ids)) {
            documents.put(document.getId(), document);
        }
        // The count is the section listing's, not this page's: a page purged between the
        // listing and the load below is dropped from the page but stays counted, so the
        // total can be a row or two high until the next listing. Re-counting per page
        // would cost the full candidate scan again.
        Map<UUID, Long> childCounts = fetchChildCounts(ids);
        Set<UUID> collaboratorDocIds = fetchCollaboratorDocIds(ids);

        List<DocumentResponse> responses = pageEntries.stream()
                .map(entry -> {
                    Document doc = documents.get(entry.id());
                    if (doc == null) {
                        return null;
                    }
                    return DocumentResponses.shared(
                            doc,
                            entry.parentId(),
                            entry.orderKey(),
                            childCounts.getOrDefault(entry.id(), 0L) > 0,
                            collaboratorDocIds.contains(entry.id()),
                            entry.accessLevel(),
                            entry.spaceId(),
                            entry.owner());
                })
                .filter(Objects::nonNull)
                .toList();

        return new PageImpl<>(responses, pageable, total);
    }

    /**
     * Root pages filed into one space, in the space's shared order. Gated on content
     * read only: a workspace admin who is not a member may administer the space but must
     * not enumerate the pages inside it.
     */
    private Page<DocumentResponse> listSpaceRootDocuments(UUID userId, UUID spaceId, Pageable pageable) {
        spaceAccessService.requireContentRead(userId, spaceId);

        Page<Document> page = documentRepository.findSpaceRootDocuments(userId, spaceId, pageable);
        List<Document> docs = page.getContent();
        if (docs.isEmpty()) {
            return new PageImpl<>(List.of(), pageable, page.getTotalElements());
        }

        List<UUID> docIds = docs.stream().map(Document::getId).toList();
        Map<UUID, Long> childCounts = fetchChildCounts(docIds);
        Set<UUID> collaboratorDocIds = new HashSet<>(accessGrantRepository.findDocumentIdsWithPositiveGrants(docIds));
        // Resolve owned pages too: an archived space caps every level, ownership included,
        // at VIEW, and the DTO must not advertise a write grant.
        Map<UUID, DocumentAccessLevel> accessLevels = fetchAccessLevels(userId, docIds);

        return page.map(doc -> {
            boolean hasChildren = childCounts.getOrDefault(doc.getId(), 0L) > 0;
            boolean hasCollaborators = collaboratorDocIds.contains(doc.getId());
            DocumentAccessLevel access = accessLevels.getOrDefault(doc.getId(), null);

            return DocumentResponses.of(
                    doc, null, doc.getSiblingOrderKey(), hasChildren, hasCollaborators, access, null, null);
        });
    }

    private static UUID parseSpaceId(String raw) {
        try {
            return UUID.fromString(raw.trim());
        } catch (IllegalArgumentException ex) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Invalid spaceId format: " + raw);
        }
    }

    private Page<DocumentResponse> listChildDocuments(
            UUID userId, String parentIdStr, String scope, Pageable pageable) {
        if (scope != null && !scope.isBlank() && !"all".equalsIgnoreCase(scope.trim())) {
            throw new ApiException(
                    ErrorCode.VALIDATION_FAILED,
                    "The scope parameter is only valid for root-level or flat queries, not with a specific parentId.");
        }

        UUID parentId;
        try {
            parentId = UUID.fromString(parentIdStr);
        } catch (IllegalArgumentException e) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Invalid parentId format: " + parentIdStr);
        }

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

        List<UUID> childIds = documentRepository.findChildIdsByParent_IdAndDeletedAtIsNull(parentId);
        Map<UUID, DocumentAccessLevel> accessLevels = fetchAccessLevels(userId, childIds);
        List<UUID> readableIds =
                childIds.stream().filter(accessLevels::containsKey).toList();
        if (readableIds.isEmpty()) {
            return Page.empty(effectivePageable);
        }

        Page<Document> page = documentRepository.findAllByIdInAndParent_IdAndDeletedAtIsNull(
                readableIds, parentId, effectivePageable);
        List<Document> docs = page.getContent();
        if (docs.isEmpty()) {
            return new PageImpl<>(List.of(), effectivePageable, page.getTotalElements());
        }

        List<UUID> docIds = docs.stream().map(Document::getId).toList();
        Map<UUID, Long> childCounts = fetchChildCounts(docIds);
        Set<UUID> collaboratorDocIds = new HashSet<>(accessGrantRepository.findDocumentIdsWithPositiveGrants(docIds));

        return page.map(doc -> {
            boolean hasChildren = childCounts.getOrDefault(doc.getId(), 0L) > 0;
            boolean hasCollaborators = collaboratorDocIds.contains(doc.getId());
            DocumentAccessLevel access = accessLevels.getOrDefault(doc.getId(), null);

            return DocumentResponses.of(
                    doc, parentId, doc.getSiblingOrderKey(), hasChildren, hasCollaborators, access, null, null);
        });
    }

    private Page<DocumentResponse> listFlatDocuments(UUID userId, String scope, Pageable pageable) {
        Pageable effectivePageable = pageable;
        if (effectivePageable == null || effectivePageable.getSort().isUnsorted()) {
            Sort sort = Sort.by(Sort.Order.desc("updatedAt"), Sort.Order.desc("createdAt"), Sort.Order.asc("id"));
            effectivePageable = effectivePageable != null
                    ? PageRequest.of(effectivePageable.getPageNumber(), effectivePageable.getPageSize(), sort)
                    : PageRequest.of(0, 20, sort);
        }

        String normalizedScope =
                scope != null && !scope.isBlank() ? scope.trim().toLowerCase() : "all";

        if ("private".equals(normalizedScope) || "shared".equals(normalizedScope)) {
            throw new ApiException(
                    ErrorCode.VALIDATION_FAILED, "scope=" + normalizedScope + " is only supported for root documents.");
        }

        // The native query takes SQL column names, and the client controls the sort, so
        // map to a fixed allowlist instead of splicing its property name into the SQL.
        Sort sqlSort = Sort.by(effectivePageable.getSort().stream()
                .filter(order -> NATIVE_SORT_COLUMNS.containsKey(order.getProperty()))
                .map(order -> order.withProperty(NATIVE_SORT_COLUMNS.get(order.getProperty())))
                .toList());
        Pageable sqlPageable = PageRequest.of(
                effectivePageable.getPageNumber(),
                effectivePageable.getPageSize(),
                sqlSort.isSorted()
                        ? sqlSort
                        : Sort.by(Sort.Order.desc("updated_at"), Sort.Order.desc("created_at"), Sort.Order.asc("id")));
        Page<Object[]> page = documentRepository.findReachableDocuments(userId, sqlPageable);
        Map<UUID, DocumentAccessLevel> accessLevels = new HashMap<>();
        List<UUID> pageIds = page.getContent().stream()
                .map(row -> {
                    UUID id = (UUID) row[0];
                    accessLevels.put(id, DocumentAccessLevel.valueOf(row[1].toString()));
                    return id;
                })
                .toList();

        Map<UUID, Document> documentsById = new HashMap<>();
        for (Document document : documentRepository.findAllById(pageIds)) {
            documentsById.put(document.getId(), document);
        }
        List<Document> readableDocs = pageIds.stream()
                .map(documentsById::get)
                .filter(Objects::nonNull)
                .toList();

        List<UUID> pageDocumentIds = readableDocs.stream().map(Document::getId).toList();
        Map<UUID, Long> childCounts = fetchChildCounts(pageDocumentIds);
        Set<UUID> collaboratorDocIds = fetchCollaboratorDocIds(pageDocumentIds);
        Map<UUID, String> rootOrderKeys = fetchRootOrderKeys(userId, readableDocs);

        List<DocumentResponse> responses = readableDocs.stream()
                .map(doc -> {
                    boolean hasChildren = childCounts.getOrDefault(doc.getId(), 0L) > 0;
                    boolean hasCollaborators = collaboratorDocIds.contains(doc.getId());
                    // A root page inside a space uses the space's shared key; a Private/Shared
                    // root uses the caller's personal navigation key.
                    String orderKey = doc.getParent() != null
                            ? doc.getSiblingOrderKey()
                            : doc.getSpace() != null ? doc.getSiblingOrderKey() : rootOrderKeys.get(doc.getId());
                    UUID parentDocId = doc.getParent() != null ? doc.getParent().getId() : null;

                    return DocumentResponses.of(
                            doc,
                            parentDocId,
                            orderKey,
                            hasChildren,
                            hasCollaborators,
                            accessLevels.get(doc.getId()),
                            null,
                            null);
                })
                .toList();
        return new PageImpl<>(responses, effectivePageable, page.getTotalElements());
    }

    /** The requested window of an already ordered, fully resolved list. */
    private static <T> List<T> pageSlice(List<T> items, Pageable pageable) {
        if (pageable.isUnpaged()) {
            return items;
        }
        int start = (int) Math.min(pageable.getOffset(), items.size());
        int end = Math.min(start + pageable.getPageSize(), items.size());
        return items.subList(start, end);
    }

    private Map<UUID, Long> fetchChildCounts(Collection<UUID> docIds) {
        if (docIds.isEmpty()) return Map.of();
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

    private Set<UUID> fetchCollaboratorDocIds(Collection<UUID> docIds) {
        // An out-of-range page still resolves its total, so the empty page must not
        // reach the IN-query with no ids.
        if (docIds.isEmpty()) {
            return Set.of();
        }
        return new HashSet<>(accessGrantRepository.findDocumentIdsWithPositiveGrants(docIds));
    }

    private Map<UUID, DocumentAccessLevel> fetchAccessLevels(UUID userId, Collection<UUID> docIds) {
        // Single canonical batch resolver (null-safe, allowsRead-gated).
        return permissionService.resolveAccessBatch(userId, docIds);
    }

    private Map<UUID, DocumentAccessLevel> fetchTrashAccessLevels(UUID userId, Collection<UUID> docIds) {
        return permissionService.resolveTrashAccessBatch(userId, docIds);
    }

    private Map<UUID, String> fetchUserOrderKeys(UUID userId, Collection<UUID> docIds) {
        if (docIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, String> orderKeys = new HashMap<>();
        for (Object[] row : userDocumentOrderRepository.findOrderKeysByUserIdAndDocumentIds(userId, docIds)) {
            orderKeys.put((UUID) row[0], (String) row[1]);
        }
        return orderKeys;
    }

    private Map<UUID, String> fetchRootOrderKeys(UUID userId, List<Document> docs) {
        List<UUID> rootIds = docs.stream()
                .filter(document -> document.getParent() == null && document.getSpace() == null)
                .map(Document::getId)
                .toList();
        return fetchUserOrderKeys(userId, rootIds);
    }
}
