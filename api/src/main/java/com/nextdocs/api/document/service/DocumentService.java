package com.nextdocs.api.document.service;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.config.DocumentProperties;
import com.nextdocs.api.document.dto.request.DocumentCreateRequest;
import com.nextdocs.api.document.dto.request.DocumentUpdateRequest;
import com.nextdocs.api.document.dto.response.DocumentResponse;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.entity.DocumentCollaborator;
import com.nextdocs.api.document.entity.DocumentGeneralAccessMode;
import com.nextdocs.api.document.repository.DocumentCollaboratorRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Base64;
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
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class DocumentService {

    public record CreateDocumentResult(DocumentResponse document, boolean created) {}

    private final DocumentRepository documentRepository;
    private final DocumentCollaboratorRepository collaboratorRepository;
    private final UserRepository userRepository;
    private final DocumentProperties documentProperties;

    @Autowired
    @Lazy
    private DocumentService selfProxy;

    @Transactional
    public CreateDocumentResult create(UUID userId, DocumentCreateRequest request) {
        User user = userRepository.findById(userId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
        String yjsState = request.yjsState();

        UUID documentId = request.id() != null ? request.id() : UUID.randomUUID();

        if (request.id() != null) {
            Document existing =
                    documentRepository.findByIdAndUser_Id(documentId, userId).orElse(null);
            if (existing != null) {
                if (existing.getDeletedAt() != null) {
                    throw new ApiException(
                            ErrorCode.CONFLICT,
                            "A trashed document already exists with this ID. Restore or permanently delete it first.");
                }
                return new CreateDocumentResult(toResponse(existing, true), false);
            }
        }

        Document document = Document.builder()
                .id(documentId)
                .user(user)
                .title(normalizeTitle(request.title()))
                .yjsState(decodeBase64State(yjsState))
                .createdBy(request.createdBy())
                .build();

        try {
            return new CreateDocumentResult(toResponse(documentRepository.saveAndFlush(document), true), true);
        } catch (DataIntegrityViolationException ex) {
            if (request.id() == null) {
                throw ex;
            }

            Document existing = documentRepository.findById(documentId).orElseThrow(() -> ex);
            if (!existing.getUser().getId().equals(userId)) {
                throw new ApiException(ErrorCode.CONFLICT, "A document already exists with this ID.");
            }
            if (existing.getDeletedAt() != null) {
                throw new ApiException(
                        ErrorCode.CONFLICT,
                        "A trashed document already exists with this ID. Restore or permanently delete it first.");
            }
            return new CreateDocumentResult(toResponse(existing, true), false);
        }
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
            document = documentRepository.findById(documentId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));

            if (document.getDeletedAt() != null) {
                // Document is in trash - only the owner can access it
                if (!document.getUser().getId().equals(userId)) {
                    throw new ApiException(ErrorCode.NOT_FOUND);
                }
            } else {
                // Active document - check if the user is the owner or has valid collaborator/public access
                if (!document.getUser().getId().equals(userId)) {
                    DocumentAccessLevel effectiveAccess = resolveEffectiveNonOwnerAccess(userId, document);
                    if (effectiveAccess == null) {
                        throw new ApiException(ErrorCode.NOT_FOUND);
                    }
                }
            }
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

    private static String normalizeTitle(String title) {
        String value = title == null ? "" : title.strip();
        if (value.isBlank()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Title must not be blank.");
        }
        return value;
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
