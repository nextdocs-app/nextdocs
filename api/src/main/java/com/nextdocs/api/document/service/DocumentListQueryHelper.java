package com.nextdocs.api.document.service;

import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.config.DocumentProperties;
import com.nextdocs.api.document.dto.response.DocumentResponse;
import com.nextdocs.api.document.dto.response.DocumentResponses;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.repository.AccessGrantRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.repository.UserDocumentOrderRepository;
import com.nextdocs.api.space.service.SpaceAccessService;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
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
    private final DocumentProperties documentProperties;
    private final PermissionService permissionService;
    private final SpaceAccessService spaceAccessService;

    private static final Set<String> KNOWN_SCOPES = Set.of("all", "private", "shared", "space");

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
            // Unpaged candidate query: hierarchical ACL breakpoints and deny rules
            // require post-query access filtering before pagination to avoid jagged pages.
            Page<Object[]> rows = documentRepository.findSharedRootDocuments(userId, Pageable.unpaged());
            List<Document> candidates =
                    rows.getContent().stream().map(r -> (Document) r[0]).toList();
            if (candidates.isEmpty()) {
                return new PageImpl<>(List.of(), pageable, 0);
            }

            List<UUID> nonOwnedIds = candidates.stream()
                    .filter(d -> !d.getUser().getId().equals(userId))
                    .map(Document::getId)
                    .toList();
            Map<UUID, DocumentAccessLevel> accessLevels = fetchAccessLevels(userId, nonOwnedIds);
            List<Object[]> visibleRows = rows.getContent().stream()
                    .filter(row -> {
                        Document doc = (Document) row[0];
                        return doc.getUser().getId().equals(userId) || accessLevels.containsKey(doc.getId());
                    })
                    .toList();
            if (visibleRows.isEmpty()) {
                return new PageImpl<>(List.of(), pageable, 0);
            }

            List<UUID> docIds =
                    visibleRows.stream().map(r -> ((Document) r[0]).getId()).toList();
            Map<UUID, Long> childCounts = fetchChildCounts(docIds);
            Set<UUID> collaboratorDocIds =
                    new HashSet<>(accessGrantRepository.findDocumentIdsWithPositiveGrants(docIds));

            List<DocumentResponse> responses = visibleRows.stream()
                    .map(r -> {
                        Document doc = (Document) r[0];
                        String orderKey = (String) r[1];
                        boolean hasChildren = childCounts.getOrDefault(doc.getId(), 0L) > 0;
                        boolean hasCollaborators = collaboratorDocIds.contains(doc.getId());
                        DocumentAccessLevel access = doc.getUser().getId().equals(userId)
                                ? DocumentAccessLevel.OWNER
                                : accessLevels.getOrDefault(doc.getId(), null);
                        UUID parentDocId =
                                doc.getParent() != null ? doc.getParent().getId() : null;

                        return DocumentResponses.of(
                                doc, parentDocId, orderKey, hasChildren, hasCollaborators, access, null, null);
                    })
                    .toList();

            return paginateList(responses, pageable);
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
                                DocumentAccessLevel.OWNER,
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

        if ("private".equals(normalizedScope)) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "scope=private is only supported for root documents.");
        }

        if ("shared".equals(normalizedScope)) {
            // Unpaged candidate query: nested floated roots and inheritance breakpoints
            // must resolve effective access before applying client pagination.
            Page<Document> page = documentRepository.findSharedWithUserId(userId, Pageable.unpaged());
            List<Document> candidates = page.getContent();
            if (candidates.isEmpty()) {
                return new PageImpl<>(List.of(), effectivePageable, 0);
            }

            List<UUID> candidateIds = candidates.stream().map(Document::getId).toList();
            Map<UUID, DocumentAccessLevel> accessLevels = fetchAccessLevels(userId, candidateIds);
            List<Document> docs = candidates.stream()
                    .filter(doc -> accessLevels.containsKey(doc.getId()))
                    .toList();
            if (docs.isEmpty()) {
                return new PageImpl<>(List.of(), effectivePageable, 0);
            }

            List<UUID> docIds = docs.stream().map(Document::getId).toList();
            Map<UUID, Long> childCounts = fetchChildCounts(docIds);
            Set<UUID> collaboratorDocIds =
                    new HashSet<>(accessGrantRepository.findDocumentIdsWithPositiveGrants(docIds));

            Set<UUID> parentIds = docs.stream()
                    .map(Document::getParent)
                    .filter(Objects::nonNull)
                    .map(Document::getId)
                    .collect(Collectors.toSet());
            Map<UUID, DocumentAccessLevel> parentAccess = fetchAccessLevels(userId, parentIds);

            List<UUID> rootAndFloatedDocIds = docs.stream()
                    .filter(d -> d.getParent() == null
                            || parentAccess.get(d.getParent().getId()) == null)
                    .map(Document::getId)
                    .toList();
            Map<UUID, String> userOrderKeys = fetchUserOrderKeys(userId, rootAndFloatedDocIds);

            List<DocumentResponse> responses = docs.stream()
                    .map(doc -> {
                        boolean hasChildren = childCounts.getOrDefault(doc.getId(), 0L) > 0;
                        boolean hasCollaborators = collaboratorDocIds.contains(doc.getId());
                        DocumentAccessLevel access = accessLevels.getOrDefault(doc.getId(), null);
                        boolean isRootForUser = doc.getParent() == null
                                || parentAccess.get(doc.getParent().getId()) == null;
                        String orderKey = isRootForUser ? userOrderKeys.get(doc.getId()) : doc.getSiblingOrderKey();
                        UUID parentDocId =
                                doc.getParent() != null ? doc.getParent().getId() : null;

                        return DocumentResponses.of(
                                doc, parentDocId, orderKey, hasChildren, hasCollaborators, access, null, null);
                    })
                    .toList();
            return paginateList(responses, effectivePageable);
        }

        Page<Document> page = documentRepository.findAllByUser_IdAndDeletedAtIsNull(userId, effectivePageable);
        List<Document> docs = page.getContent();
        if (docs.isEmpty()) {
            return new PageImpl<>(List.of(), effectivePageable, page.getTotalElements());
        }

        List<UUID> docIds = docs.stream().map(Document::getId).toList();
        Map<UUID, Long> childCounts = fetchChildCounts(docIds);
        Set<UUID> collaboratorDocIds = new HashSet<>(accessGrantRepository.findDocumentIdsWithPositiveGrants(docIds));
        Map<UUID, String> rootOrderKeys = fetchRootOrderKeys(userId, docs);
        // The "mine" scope is every page the caller owns, space pages included; an
        // archived space caps those at VIEW like every other projection.
        Map<UUID, DocumentAccessLevel> accessLevels = fetchAccessLevels(userId, docIds);

        return page.map(doc -> {
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
                    accessLevels.getOrDefault(doc.getId(), null),
                    null,
                    null);
        });
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

    private static Page<DocumentResponse> paginateList(List<DocumentResponse> items, Pageable pageable) {
        if (pageable == null || pageable.isUnpaged()) {
            return new PageImpl<>(items, Pageable.unpaged(), items.size());
        }
        List<DocumentResponse> sorted = items;
        if (pageable.getSort().isSorted()) {
            Comparator<DocumentResponse> comparator = comparatorFor(pageable.getSort());
            if (comparator != null) {
                sorted = items.stream().sorted(comparator).toList();
            }
        }
        int total = sorted.size();
        int start = (int) Math.min(pageable.getOffset(), total);
        int end = Math.min(start + pageable.getPageSize(), total);
        List<DocumentResponse> pageContent = sorted.subList(start, end);
        return new PageImpl<>(pageContent, pageable, total);
    }

    private static Comparator<DocumentResponse> comparatorFor(Sort sort) {
        if (sort == null || sort.isUnsorted()) {
            return null;
        }
        Comparator<DocumentResponse> comparator = null;
        for (Sort.Order order : sort) {
            Comparator<DocumentResponse> step = comparatorForProperty(order);
            if (step != null) {
                comparator = comparator == null ? step : comparator.thenComparing(step);
            }
        }
        return comparator;
    }

    private static Comparator<DocumentResponse> comparatorForProperty(Sort.Order order) {
        String property = order.getProperty();
        if (property == null) {
            return null;
        }
        return switch (property) {
            case "title" -> Comparator.comparing(DocumentResponse::title, stringComparator(order));
            case "updatedAt" -> Comparator.comparing(DocumentResponse::updatedAt, valueComparator(order));
            case "createdAt" -> Comparator.comparing(DocumentResponse::createdAt, valueComparator(order));
            case "deletedAt" -> Comparator.comparing(DocumentResponse::deletedAt, valueComparator(order));
            case "id" -> Comparator.comparing(DocumentResponse::id, valueComparator(order));
            case "orderKey", "siblingOrderKey" ->
                Comparator.comparing(DocumentResponse::orderKey, stringComparator(order));
            default -> null;
        };
    }

    private static <T extends Comparable<T>> Comparator<T> valueComparator(Sort.Order order) {
        Comparator<T> natural = Comparator.naturalOrder();
        Comparator<T> base = order.isDescending() ? natural.reversed() : natural;
        return order.getNullHandling() == Sort.NullHandling.NULLS_FIRST
                ? Comparator.nullsFirst(base)
                : Comparator.nullsLast(base);
    }

    private static Comparator<String> stringComparator(Sort.Order order) {
        Comparator<String> natural = order.isIgnoreCase() || "title".equals(order.getProperty())
                ? String.CASE_INSENSITIVE_ORDER
                : Comparator.naturalOrder();
        Comparator<String> base = order.isDescending() ? natural.reversed() : natural;
        return order.getNullHandling() == Sort.NullHandling.NULLS_FIRST
                ? Comparator.nullsFirst(base)
                : Comparator.nullsLast(base);
    }
}
