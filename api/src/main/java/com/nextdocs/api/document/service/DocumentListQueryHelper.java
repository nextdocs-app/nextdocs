package com.nextdocs.api.document.service;

import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.config.DocumentProperties;
import com.nextdocs.api.document.dto.response.DocumentResponse;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.repository.DocumentCollaboratorRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.repository.UserDocumentOrderRepository;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
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
    private final DocumentCollaboratorRepository collaboratorRepository;
    private final UserDocumentOrderRepository userDocumentOrderRepository;
    private final DocumentProperties documentProperties;
    private final PermissionService permissionService;

    @Transactional(readOnly = true)
    public Page<DocumentResponse> list(UUID userId, String parentId, String scope, Boolean trashed, Pageable pageable) {
        boolean trashedOnly = Boolean.TRUE.equals(trashed);
        if (trashedOnly) {
            if (parentId != null && !parentId.trim().isEmpty()) {
                throw new ApiException(ErrorCode.VALIDATION_FAILED, "parentId cannot be combined with trashed=true");
            }
            if (scope != null && !scope.isBlank() && !"all".equalsIgnoreCase(scope.trim())) {
                throw new ApiException(ErrorCode.VALIDATION_FAILED, "scope cannot be combined with trashed=true");
            }
            return listTrashed(userId, pageable);
        }

        if (parentId != null) {
            String trimmedParentId = parentId.trim();
            if ("root".equalsIgnoreCase(trimmedParentId)) {
                return listRootDocuments(userId, scope, pageable);
            }

            return listChildDocuments(userId, trimmedParentId, scope, pageable);
        }

        return listFlatDocuments(userId, scope, pageable);
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
        Set<UUID> collaboratorDocIds = new HashSet<>(collaboratorRepository.findDocumentIdsWithCollaborators(docIds));
        Map<UUID, DocumentAccessLevel> trashAccessLevels = fetchTrashAccessLevels(userId, docIds);

        return page.map(doc -> {
            OffsetDateTime deletedAt = doc.getDeletedAt();
            OffsetDateTime purgeAt =
                    deletedAt != null ? deletedAt.plusDays(documentProperties.getTrashRetentionDays()) : null;
            DocumentAccessLevel access = trashAccessLevels.get(doc.getId());
            boolean hasCollaborators = collaboratorDocIds.contains(doc.getId());
            UUID parentDocId = doc.getParent() != null ? doc.getParent().getId() : null;

            return new DocumentResponse(
                    doc.getId(),
                    doc.getTitle(),
                    null,
                    parentDocId,
                    doc.getSiblingOrderKey(),
                    false,
                    hasCollaborators,
                    access,
                    doc.getCreatedBy(),
                    doc.getCreatedAt(),
                    doc.getUpdatedAt(),
                    deletedAt,
                    purgeAt);
        });
    }

    private Page<DocumentResponse> listRootDocuments(UUID userId, String scope, Pageable pageable) {
        String normalizedScope =
                scope != null && !scope.isBlank() ? scope.trim().toLowerCase() : "all";

        if ("shared".equals(normalizedScope)) {
            Page<Object[]> rows = documentRepository.findSharedRootDocuments(userId, pageable);
            List<Document> docs =
                    rows.getContent().stream().map(r -> (Document) r[0]).toList();
            if (docs.isEmpty()) {
                return new PageImpl<>(List.of(), pageable, rows.getTotalElements());
            }

            List<UUID> docIds = docs.stream().map(Document::getId).toList();
            Map<UUID, Long> childCounts = fetchChildCounts(docIds);
            Set<UUID> collaboratorDocIds =
                    new HashSet<>(collaboratorRepository.findDocumentIdsWithCollaborators(docIds));
            List<UUID> nonOwnedIds = docs.stream()
                    .filter(d -> !d.getUser().getId().equals(userId))
                    .map(Document::getId)
                    .toList();
            Map<UUID, DocumentAccessLevel> accessLevels = fetchAccessLevels(userId, nonOwnedIds);

            List<DocumentResponse> responses = rows.getContent().stream()
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

                        return new DocumentResponse(
                                doc.getId(),
                                doc.getTitle(),
                                null,
                                parentDocId,
                                orderKey,
                                hasChildren,
                                hasCollaborators,
                                access,
                                doc.getCreatedBy(),
                                doc.getCreatedAt(),
                                doc.getUpdatedAt(),
                                null,
                                null);
                    })
                    .toList();

            return new PageImpl<>(responses, pageable, rows.getTotalElements());
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
                    new HashSet<>(collaboratorRepository.findDocumentIdsWithCollaborators(docIds));

            List<DocumentResponse> responses = rows.getContent().stream()
                    .map(r -> {
                        Document doc = (Document) r[0];
                        String orderKey = (String) r[1];
                        boolean hasChildren = childCounts.getOrDefault(doc.getId(), 0L) > 0;
                        boolean hasCollaborators = collaboratorDocIds.contains(doc.getId());

                        return new DocumentResponse(
                                doc.getId(),
                                doc.getTitle(),
                                null,
                                null,
                                orderKey,
                                hasChildren,
                                hasCollaborators,
                                DocumentAccessLevel.OWNER,
                                doc.getCreatedBy(),
                                doc.getCreatedAt(),
                                doc.getUpdatedAt(),
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

                        return new DocumentResponse(
                                doc.getId(),
                                doc.getTitle(),
                                null,
                                null,
                                orderKey,
                                hasChildren,
                                false,
                                DocumentAccessLevel.OWNER,
                                doc.getCreatedBy(),
                                doc.getCreatedAt(),
                                doc.getUpdatedAt(),
                                null,
                                null);
                    })
                    .toList();

            return new PageImpl<>(responses, pageable, rows.getTotalElements());
        }

        throw new ApiException(
                ErrorCode.VALIDATION_FAILED,
                "Invalid scope value for root documents: " + scope + ". Must be 'private', 'shared', or 'all'.");
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

        Page<Document> page = documentRepository.findAllByParent_IdAndDeletedAtIsNull(parentId, effectivePageable);
        List<Document> docs = page.getContent();
        if (docs.isEmpty()) {
            return new PageImpl<>(List.of(), effectivePageable, page.getTotalElements());
        }

        List<UUID> docIds = docs.stream().map(Document::getId).toList();
        Map<UUID, Long> childCounts = fetchChildCounts(docIds);
        Set<UUID> collaboratorDocIds = new HashSet<>(collaboratorRepository.findDocumentIdsWithCollaborators(docIds));

        List<UUID> nonOwnedIds = docs.stream()
                .filter(d -> !d.getUser().getId().equals(userId))
                .map(Document::getId)
                .toList();
        Map<UUID, DocumentAccessLevel> accessLevels = fetchAccessLevels(userId, nonOwnedIds);

        return page.map(doc -> {
            boolean hasChildren = childCounts.getOrDefault(doc.getId(), 0L) > 0;
            boolean hasCollaborators = collaboratorDocIds.contains(doc.getId());
            DocumentAccessLevel access = doc.getUser().getId().equals(userId)
                    ? DocumentAccessLevel.OWNER
                    : accessLevels.getOrDefault(doc.getId(), null);

            return new DocumentResponse(
                    doc.getId(),
                    doc.getTitle(),
                    null,
                    parentId,
                    doc.getSiblingOrderKey(),
                    hasChildren,
                    hasCollaborators,
                    access,
                    doc.getCreatedBy(),
                    doc.getCreatedAt(),
                    doc.getUpdatedAt(),
                    null,
                    null);
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

        if ("shared".equals(normalizedScope)) {
            Page<Document> page = documentRepository.findSharedWithUserId(userId, effectivePageable);
            List<Document> docs = page.getContent();
            if (docs.isEmpty()) {
                return new PageImpl<>(List.of(), effectivePageable, page.getTotalElements());
            }

            List<UUID> docIds = docs.stream().map(Document::getId).toList();
            Map<UUID, Long> childCounts = fetchChildCounts(docIds);
            Set<UUID> collaboratorDocIds =
                    new HashSet<>(collaboratorRepository.findDocumentIdsWithCollaborators(docIds));
            Map<UUID, DocumentAccessLevel> accessLevels = fetchAccessLevels(userId, docIds);
            Map<UUID, String> rootOrderKeys = fetchRootOrderKeys(userId, docs);

            return page.map(doc -> {
                boolean hasChildren = childCounts.getOrDefault(doc.getId(), 0L) > 0;
                boolean hasCollaborators = collaboratorDocIds.contains(doc.getId());
                DocumentAccessLevel access = accessLevels.getOrDefault(doc.getId(), null);
                String orderKey = doc.getParent() != null ? doc.getSiblingOrderKey() : rootOrderKeys.get(doc.getId());
                UUID parentDocId = doc.getParent() != null ? doc.getParent().getId() : null;

                return new DocumentResponse(
                        doc.getId(),
                        doc.getTitle(),
                        null,
                        parentDocId,
                        orderKey,
                        hasChildren,
                        hasCollaborators,
                        access,
                        doc.getCreatedBy(),
                        doc.getCreatedAt(),
                        doc.getUpdatedAt(),
                        null,
                        null);
            });
        }

        Page<Document> page = documentRepository.findAllByUser_IdAndDeletedAtIsNull(userId, effectivePageable);
        List<Document> docs = page.getContent();
        if (docs.isEmpty()) {
            return new PageImpl<>(List.of(), effectivePageable, page.getTotalElements());
        }

        List<UUID> docIds = docs.stream().map(Document::getId).toList();
        Map<UUID, Long> childCounts = fetchChildCounts(docIds);
        Set<UUID> collaboratorDocIds = new HashSet<>(collaboratorRepository.findDocumentIdsWithCollaborators(docIds));
        Map<UUID, String> rootOrderKeys = fetchRootOrderKeys(userId, docs);

        return page.map(doc -> {
            boolean hasChildren = childCounts.getOrDefault(doc.getId(), 0L) > 0;
            boolean hasCollaborators = collaboratorDocIds.contains(doc.getId());
            String orderKey = doc.getParent() != null ? doc.getSiblingOrderKey() : rootOrderKeys.get(doc.getId());
            UUID parentDocId = doc.getParent() != null ? doc.getParent().getId() : null;

            return new DocumentResponse(
                    doc.getId(),
                    doc.getTitle(),
                    null,
                    parentDocId,
                    orderKey,
                    hasChildren,
                    hasCollaborators,
                    DocumentAccessLevel.OWNER,
                    doc.getCreatedBy(),
                    doc.getCreatedAt(),
                    doc.getUpdatedAt(),
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
        if (docIds.isEmpty()) return Map.of();
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

    private Map<UUID, DocumentAccessLevel> fetchTrashAccessLevels(UUID userId, Collection<UUID> docIds) {
        if (docIds.isEmpty()) return Map.of();
        Map<UUID, DocumentAccessLevel> accessLevels = new HashMap<>();
        String joinedIds = docIds.stream().map(UUID::toString).collect(Collectors.joining(","));
        for (Object[] row : documentRepository.resolveTrashAccessBatch(userId, joinedIds)) {
            if (row[0] != null && row[1] != null) {
                UUID docId = row[0] instanceof UUID u ? u : UUID.fromString(row[0].toString());
                accessLevels.put(docId, DocumentAccessLevel.valueOf(row[1].toString()));
            }
        }
        return accessLevels;
    }

    private Map<UUID, String> fetchRootOrderKeys(UUID userId, List<Document> docs) {
        List<UUID> rootIds = docs.stream()
                .filter(document -> document.getParent() == null)
                .map(Document::getId)
                .toList();
        if (rootIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, String> orderKeys = new HashMap<>();
        for (Object[] row : userDocumentOrderRepository.findOrderKeysByUserIdAndDocumentIds(userId, rootIds)) {
            orderKeys.put((UUID) row[0], (String) row[1]);
        }
        return orderKeys;
    }
}
