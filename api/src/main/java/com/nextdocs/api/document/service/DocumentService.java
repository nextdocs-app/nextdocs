package com.nextdocs.api.document.service;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.config.DocumentProperties;
import com.nextdocs.api.document.dto.request.*;
import com.nextdocs.api.document.dto.response.*;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.entity.DocumentCollaborator;
import com.nextdocs.api.document.entity.DocumentGeneralAccessMode;
import com.nextdocs.api.document.repository.DocumentCollaboratorRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Base64;
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
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class DocumentService {

    private final DocumentRepository documentRepository;
    private final DocumentCollaboratorRepository collaboratorRepository;
    private final UserRepository userRepository;
    private final DocumentProperties documentProperties;

    @Autowired
    @Lazy
    private DocumentService selfProxy;

    @Transactional
    public DocumentResponse create(UUID userId, DocumentCreateRequest request) {
        User user = userRepository.findById(userId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
        String sourceLocalId = normalizeSourceLocalId(request.sourceLocalId());
        String yjsState = request.yjsState();

        if (yjsState == null) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "yjsState is required.");
        }

        if (sourceLocalId != null) {
            Document existing = documentRepository
                    .findByUser_IdAndSourceLocalIdAndDeletedAtIsNull(userId, sourceLocalId)
                    .orElse(null);

            if (existing != null) {
                applyFields(existing, user, request.title(), yjsState, request.createdBy(), sourceLocalId);
                return toResponse(documentRepository.save(existing), true);
            }
        }

        Document document = Document.builder()
                .user(user)
                .title(normalizeTitle(request.title()))
                .yjsState(decodeBase64State(yjsState))
                .createdBy(request.createdBy())
                .sourceLocalId(sourceLocalId)
                .build();

        if (sourceLocalId != null) {
            try {
                return toResponse(documentRepository.saveAndFlush(document), true);
            } catch (DataIntegrityViolationException ex) {
                Document existing = documentRepository
                        .findByUser_IdAndSourceLocalIdAndDeletedAtIsNull(userId, sourceLocalId)
                        .orElseThrow(() -> ex);

                applyFields(existing, user, request.title(), yjsState, request.createdBy(), sourceLocalId);
                return toResponse(documentRepository.save(existing), true);
            }
        }

        return toResponse(documentRepository.save(document), true);
    }

    @Transactional(readOnly = true)
    public Page<DocumentResponse> list(UUID userId, Pageable pageable, boolean trashedOnly) {
        Pageable effectivePageable = pageable;
        if (effectivePageable == null) {
            effectivePageable = PageRequest.of(0, 20);
        }

        if (effectivePageable.getSort().isUnsorted()) {
            Sort sort = trashedOnly
                    ? Sort.by(Sort.Order.desc("deletedAt"), Sort.Order.asc("id"))
                    : Sort.by(Sort.Order.desc("updatedAt"), Sort.Order.desc("createdAt"), Sort.Order.asc("id"));
            effectivePageable =
                    PageRequest.of(effectivePageable.getPageNumber(), effectivePageable.getPageSize(), sort);
        }

        Page<Document> page = trashedOnly
                ? documentRepository.findAllByUser_IdAndDeletedAtIsNotNull(userId, effectivePageable)
                : documentRepository.findAllByUser_IdAndDeletedAtIsNull(userId, effectivePageable);

        return page.map(document -> toResponse(document, false));
    }

    @Transactional(readOnly = true)
    public DocumentResponse get(UUID userId, UUID documentId, boolean includeTrashed) {
        Document document;
        if (includeTrashed) {
            document = documentRepository
                    .findByIdAndUser_Id(documentId, userId)
                    .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
        } else {
            document = findAccessibleActiveDocument(userId, documentId, false);
        }
        return toResponse(document, true);
    }

    @Transactional(readOnly = true)
    public DocumentResponse getPublic(UUID documentId) {
        Document document = documentRepository
                .findByIdAndDeletedAtIsNull(documentId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));

        if (resolveGeneralAccessLevel(document) == null) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }

        return toResponse(document, true);
    }

    @Transactional
    public DocumentResponse update(UUID userId, UUID documentId, DocumentUpdateRequest request) {
        Document document =
                documentRepository.findByIdAndDeletedAtIsNull(documentId).orElse(null);
        if (document == null) {
            if (documentRepository.findByIdAndUser_Id(documentId, userId).isPresent()) {
                throw new ApiException(ErrorCode.CONFLICT, "Cannot update a document in trash. Restore it first.");
            }
            throw new ApiException(ErrorCode.NOT_FOUND);
        }

        if (!document.getUser().getId().equals(userId)) {
            DocumentAccessLevel effectiveAccess = resolveEffectiveNonOwnerAccess(userId, document);
            if (effectiveAccess == null) {
                throw new ApiException(ErrorCode.NOT_FOUND);
            }

            if (!effectiveAccess.allowsEdit()) {
                throw new ApiException(ErrorCode.FORBIDDEN);
            }
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

        return toResponse(documentRepository.save(document), true);
    }

    @Transactional
    public void delete(UUID userId, UUID documentId, boolean permanent) {
        if (permanent) {
            Document document = documentRepository
                    .findByIdAndUser_Id(documentId, userId)
                    .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
            if (document.getDeletedAt() == null) {
                throw new ApiException(
                        ErrorCode.VALIDATION_FAILED,
                        "Permanent delete is only allowed for documents already in trash.");
            }
            documentRepository.delete(document);
            return;
        }

        Document document = documentRepository
                .findByIdAndUser_IdAndDeletedAtIsNull(documentId, userId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
        document.setDeletedAt(OffsetDateTime.now(ZoneOffset.UTC));
        documentRepository.save(document);
    }

    @Transactional
    public DocumentResponse restore(UUID userId, UUID documentId) {
        Document document = documentRepository
                .findByIdAndUser_IdAndDeletedAtIsNotNull(documentId, userId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
        document.setDeletedAt(null);
        return toResponse(documentRepository.save(document), true);
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

    @Transactional(propagation = Propagation.REQUIRED, rollbackFor = Exception.class)
    public BulkImportResponse bulkImport(UUID userId, BulkImportRequest request) {
        User user = userRepository.findById(userId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));

        List<String> sourceLocalIds = request.docs().stream()
                .map(BulkImportItemRequest::localId)
                .map(DocumentService::normalizeSourceLocalId)
                .filter(id -> id != null)
                .toList();

        Map<String, Document> existingByLocalId = new HashMap<>();
        if (!sourceLocalIds.isEmpty()) {
            existingByLocalId =
                    documentRepository
                            .findAllByUser_IdAndSourceLocalIdInAndDeletedAtIsNull(userId, sourceLocalIds)
                            .stream()
                            .collect(java.util.stream.Collectors.toMap(Document::getSourceLocalId, doc -> doc));
        }

        List<BulkImportItemResponse> imported = new java.util.ArrayList<>();
        for (BulkImportItemRequest item : request.docs()) {
            String localId = normalizeSourceLocalId(item.localId());
            Document existing = localId == null ? null : existingByLocalId.get(localId);
            Document target = existing == null ? new Document() : existing;

            applyFields(target, user, item.title(), item.yjsState(), item.createdBy(), localId);

            target = saveWithSourceLocalIdRetry(userId, localId, target, user, item);

            if (localId != null) {
                existingByLocalId.put(localId, target);
            }

            imported.add(new BulkImportItemResponse(item.localId(), target.getId(), target.getTitle()));
        }

        return new BulkImportResponse(imported);
    }

    private Document saveWithSourceLocalIdRetry(
            UUID userId, String localId, Document target, User user, BulkImportItemRequest item) {
        if (target.getId() != null) {
            return documentRepository.save(target);
        }

        try {
            return documentRepository.saveAndFlush(target);
        } catch (DataIntegrityViolationException ex) {
            if (localId == null) {
                throw ex;
            }

            Document latest = documentRepository
                    .findByUser_IdAndSourceLocalIdAndDeletedAtIsNull(userId, localId)
                    .orElseThrow(() -> ex);

            applyFields(latest, user, item.title(), item.yjsState(), item.createdBy(), localId);
            return documentRepository.save(latest);
        }
    }

    private static String normalizeTitle(String title) {
        String value = title == null ? "" : title.strip();
        if (value.isBlank()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Title must not be blank.");
        }
        return value;
    }

    private static String normalizeSourceLocalId(String sourceLocalId) {
        if (sourceLocalId == null) {
            return null;
        }

        String value = sourceLocalId.strip();
        return value.isBlank() ? null : value;
    }

    private static void applyFields(
            Document target, User user, String title, String yjsState, String createdBy, String sourceLocalId) {
        target.setUser(user);
        target.setTitle(normalizeTitle(title));
        target.setYjsState(decodeBase64State(yjsState));
        target.setCreatedBy(createdBy);
        target.setSourceLocalId(sourceLocalId);
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
        OffsetDateTime deletedAt = document.getDeletedAt();
        OffsetDateTime purgeAt = null;
        if (deletedAt != null) {
            purgeAt = deletedAt.plusDays(documentProperties.getTrashRetentionDays());
        }
        return new DocumentResponse(
                document.getId(),
                document.getTitle(),
                includeState
                        ? (document.getYjsState() != null
                                ? Base64.getEncoder().encodeToString(document.getYjsState())
                                : null)
                        : null,
                document.getCreatedBy(),
                document.getCreatedAt(),
                document.getUpdatedAt(),
                deletedAt,
                purgeAt);
    }

    private Document findAccessibleActiveDocument(UUID userId, UUID documentId, boolean requireEdit) {
        Document document = documentRepository
                .findByIdAndDeletedAtIsNull(documentId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));

        if (document.getUser().getId().equals(userId)) {
            return document;
        }

        DocumentAccessLevel effectiveAccess = resolveEffectiveNonOwnerAccess(userId, document);
        if (effectiveAccess == null) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }

        if (requireEdit && !effectiveAccess.allowsEdit()) {
            throw new ApiException(ErrorCode.FORBIDDEN);
        }

        return document;
    }

    private DocumentAccessLevel resolveEffectiveNonOwnerAccess(UUID userId, Document document) {
        DocumentAccessLevel collaboratorAccess = collaboratorRepository
                .findByDocument_IdAndUser_Id(document.getId(), userId)
                .map(DocumentCollaborator::getAccessLevel)
                .orElse(null);

        // Explicit collaborator access takes precedence over general link access.
        if (collaboratorAccess != null) {
            return collaboratorAccess;
        }

        return resolveGeneralAccessLevel(document);
    }

    private DocumentAccessLevel resolveGeneralAccessLevel(Document document) {
        if (document.getGeneralAccessMode() != DocumentGeneralAccessMode.ANYONE_WITH_LINK) {
            return null;
        }

        return document.getLinkAccessLevel();
    }
}
