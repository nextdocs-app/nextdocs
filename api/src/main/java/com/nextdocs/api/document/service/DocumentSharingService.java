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
import com.nextdocs.api.document.dto.response.DocumentResponse;
import com.nextdocs.api.document.dto.response.SharingSettingsResponse;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.entity.DocumentCollaborator;
import com.nextdocs.api.document.entity.DocumentGeneralAccessMode;
import com.nextdocs.api.document.repository.DocumentCollaboratorRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class DocumentSharingService {

    private final DocumentRepository documentRepository;
    private final DocumentCollaboratorRepository collaboratorRepository;
    private final UserRepository userRepository;

    @Transactional(readOnly = true)
    public List<CollaboratorResponse> listCollaborators(UUID requesterId, UUID documentId) {
        Document doc = requireAccessibleActiveDocument(requesterId, documentId);

        CollaboratorResponse owner = new CollaboratorResponse(
                doc.getUser().getId(),
                doc.getUser().getEmail(),
                doc.getUser().getDisplayName(),
                DocumentAccessLevel.OWNER,
                doc.getCreatedAt());

        List<CollaboratorResponse> collaborators = collaboratorRepository.findAllByDocument_Id(documentId).stream()
                .map(c -> new CollaboratorResponse(
                        c.getUser().getId(),
                        c.getUser().getEmail(),
                        c.getUser().getDisplayName(),
                        c.getAccessLevel(),
                        c.getCreatedAt()))
                .toList();

        return java.util.stream.Stream.concat(java.util.stream.Stream.of(owner), collaborators.stream())
                .toList();
    }

    @Transactional
    public CollaboratorResponse upsertCollaborator(UUID ownerId, UUID documentId, CollaboratorUpsertRequest request) {
        Document doc = requireOwnedActiveDocument(ownerId, documentId);
        DocumentAccessLevel requestedLevel = normalizeCollaboratorAccess(request.accessLevel());

        User targetUser = userRepository
                .findByEmail(request.email().strip().toLowerCase())
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "User not found for the provided email."));

        if (targetUser.getId().equals(ownerId)) {
            throw new ApiException(ErrorCode.CONFLICT, "Document owner already has owner access.");
        }

        DocumentCollaborator collaborator = collaboratorRepository
                .findByDocument_IdAndUser_Id(documentId, targetUser.getId())
                .orElseGet(() -> DocumentCollaborator.builder()
                        .document(doc)
                        .user(targetUser)
                        .build());

        collaborator.setAccessLevel(requestedLevel);
        collaborator.setGrantedBy(doc.getUser());

        DocumentCollaborator saved = collaboratorRepository.save(collaborator);

        return new CollaboratorResponse(
                saved.getUser().getId(),
                saved.getUser().getEmail(),
                saved.getUser().getDisplayName(),
                saved.getAccessLevel(),
                saved.getCreatedAt());
    }

    @Transactional
    public CollaboratorResponse updateCollaboratorAccess(
            UUID ownerId, UUID documentId, UUID collaboratorUserId, CollaboratorAccessUpdateRequest request) {
        requireOwnedActiveDocument(ownerId, documentId);

        if (ownerId.equals(collaboratorUserId)) {
            throw new ApiException(ErrorCode.CONFLICT, "Owner access cannot be changed.");
        }

        DocumentCollaborator collaborator = collaboratorRepository
                .findByDocument_IdAndUser_Id(documentId, collaboratorUserId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));

        collaborator.setAccessLevel(normalizeCollaboratorAccess(request.accessLevel()));
        DocumentCollaborator saved = collaboratorRepository.save(collaborator);

        return new CollaboratorResponse(
                saved.getUser().getId(),
                saved.getUser().getEmail(),
                saved.getUser().getDisplayName(),
                saved.getAccessLevel(),
                saved.getCreatedAt());
    }

    @Transactional
    public void removeCollaborator(UUID ownerId, UUID documentId, UUID collaboratorUserId) {
        requireOwnedActiveDocument(ownerId, documentId);

        if (ownerId.equals(collaboratorUserId)) {
            throw new ApiException(ErrorCode.CONFLICT, "Owner cannot be removed from collaborators.");
        }

        boolean exists = collaboratorRepository.existsByDocument_IdAndUser_Id(documentId, collaboratorUserId);
        if (!exists) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }

        collaboratorRepository.deleteByDocument_IdAndUser_Id(documentId, collaboratorUserId);
    }

    @Transactional
    public void leaveSharedDocument(UUID userId, UUID documentId) {
        Document doc = requireAccessibleActiveDocument(userId, documentId);

        if (doc.getUser().getId().equals(userId)) {
            throw new ApiException(ErrorCode.CONFLICT, "Owners cannot leave their own documents.");
        }

        boolean exists = collaboratorRepository.existsByDocument_IdAndUser_Id(documentId, userId);
        if (!exists) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }

        collaboratorRepository.deleteByDocument_IdAndUser_Id(documentId, userId);
    }

    @Transactional(readOnly = true)
    public SharingSettingsResponse getSharingSettings(UUID ownerId, UUID documentId) {
        Document doc = requireOwnedActiveDocument(ownerId, documentId);
        boolean hasActiveLink = doc.getGeneralAccessMode() == DocumentGeneralAccessMode.ANYONE_WITH_LINK;

        return new SharingSettingsResponse(doc.getGeneralAccessMode(), doc.getLinkAccessLevel(), hasActiveLink);
    }

    @Transactional
    public SharingSettingsResponse updateSharingSettings(
            UUID ownerId, UUID documentId, SharingSettingsUpdateRequest request) {
        Document doc = requireOwnedActiveDocument(ownerId, documentId);

        DocumentGeneralAccessMode mode = request.generalAccessMode();
        if (mode == null) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "generalAccessMode is required.");
        }

        doc.setGeneralAccessMode(mode);
        if (request.linkAccessLevel() != null) {
            doc.setLinkAccessLevel(normalizeLinkAccess(request.linkAccessLevel()));
        }

        documentRepository.save(doc);
        boolean hasActiveLink = doc.getGeneralAccessMode() == DocumentGeneralAccessMode.ANYONE_WITH_LINK;

        return new SharingSettingsResponse(doc.getGeneralAccessMode(), doc.getLinkAccessLevel(), hasActiveLink);
    }

    @Transactional(readOnly = true)
    public Page<DocumentResponse> listSharedWithMe(UUID userId, Pageable pageable) {
        return documentRepository.findSharedWithUserId(userId, pageable).map(this::toDocumentSummaryResponse);
    }

    @Transactional(readOnly = true)
    public DocumentAccessResponse getMyAccess(UUID userId, UUID documentId) {
        return computeAccess(userId, documentId);
    }

    @Transactional(readOnly = true)
    public DocumentAccessResponse accessCheck(UUID userId, UUID documentId) {
        return computeAccess(userId, documentId);
    }

    private DocumentAccessResponse computeAccess(UUID userId, UUID documentId) {
        Document doc = documentRepository.findByIdAndDeletedAtIsNull(documentId).orElse(null);
        if (doc == null) {
            return new DocumentAccessResponse(documentId, false, null, false);
        }

        if (doc.getUser().getId().equals(userId)) {
            return new DocumentAccessResponse(documentId, true, DocumentAccessLevel.OWNER, true);
        }

        DocumentCollaborator collaborator = collaboratorRepository
                .findByDocument_IdAndUser_Id(documentId, userId)
                .orElse(null);
        DocumentAccessLevel collaboratorAccess = collaborator == null ? null : collaborator.getAccessLevel();
        if (collaboratorAccess != null) {
            return new DocumentAccessResponse(documentId, true, collaboratorAccess, false);
        }

        DocumentAccessLevel effectiveAccess = resolveGeneralAccessLevel(doc);

        if (effectiveAccess != null) {
            return new DocumentAccessResponse(documentId, true, effectiveAccess, false);
        }

        return new DocumentAccessResponse(documentId, false, null, false);
    }

    private DocumentAccessLevel resolveGeneralAccessLevel(Document document) {
        if (document.getGeneralAccessMode() != DocumentGeneralAccessMode.ANYONE_WITH_LINK) {
            return null;
        }

        return document.getLinkAccessLevel();
    }

    private Document requireOwnedActiveDocument(UUID ownerId, UUID documentId) {
        return documentRepository
                .findByIdAndUser_IdAndDeletedAtIsNull(documentId, ownerId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
    }

    private Document requireAccessibleActiveDocument(UUID userId, UUID documentId) {
        Document doc = documentRepository
                .findByIdAndDeletedAtIsNull(documentId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));

        if (doc.getUser().getId().equals(userId)) {
            return doc;
        }

        boolean isCollaborator = collaboratorRepository.existsByDocument_IdAndUser_Id(documentId, userId);
        if (!isCollaborator) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }

        return doc;
    }

    private static DocumentAccessLevel normalizeCollaboratorAccess(DocumentAccessLevel accessLevel) {
        if (accessLevel == null) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "accessLevel is required.");
        }
        if (accessLevel == DocumentAccessLevel.OWNER) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "OWNER is not allowed for collaborators.");
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
        return accessLevel;
    }

    private DocumentResponse toDocumentSummaryResponse(Document document) {
        return new DocumentResponse(
                document.getId(),
                document.getTitle(),
                null,
                document.getCreatedBy(),
                document.getCreatedAt(),
                document.getUpdatedAt(),
                document.getDeletedAt(),
                null);
    }
}
