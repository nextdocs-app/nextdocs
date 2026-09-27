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
import com.nextdocs.api.document.dto.response.SharingSettingsResponse;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.entity.DocumentCollaborator;
import com.nextdocs.api.document.entity.DocumentGeneralAccessMode;
import com.nextdocs.api.document.entity.UserDocumentOrder;
import com.nextdocs.api.document.repository.DocumentCollaboratorRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.repository.UserDocumentOrderRepository;
import com.nextdocs.api.document.util.FractionalIndex;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class DocumentSharingService {

    private static final int MAX_ORDER_UPSERT_ATTEMPTS = 3;

    private final DocumentRepository documentRepository;
    private final DocumentCollaboratorRepository collaboratorRepository;
    private final UserDocumentOrderRepository userDocumentOrderRepository;
    private final UserRepository userRepository;
    private final PermissionService permissionService;

    @Autowired
    @Lazy
    private DocumentSharingService selfProxy;

    @Transactional(readOnly = true)
    public List<CollaboratorResponse> listCollaborators(UUID requesterId, UUID documentId) {
        Document doc = permissionService.requireReadAccessIncludingTrash(requesterId, documentId);

        CollaboratorResponse owner = new CollaboratorResponse(
                doc.getUser().getId(),
                doc.getUser().getEmail(),
                doc.getUser().getDisplayName(),
                DocumentAccessLevel.OWNER,
                doc.getCreatedAt(),
                true);

        List<CollaboratorResponse> collaborators = collaboratorRepository.findAllByDocument_Id(documentId).stream()
                .map(c -> new CollaboratorResponse(
                        c.getUser().getId(),
                        c.getUser().getEmail(),
                        c.getUser().getDisplayName(),
                        c.getAccessLevel(),
                        c.getCreatedAt(),
                        false))
                .toList();

        return java.util.stream.Stream.concat(java.util.stream.Stream.of(owner), collaborators.stream())
                .toList();
    }

    public CollaboratorResponse upsertCollaborator(UUID actorId, UUID documentId, CollaboratorUpsertRequest request) {
        int attempt = 0;
        while (true) {
            try {
                return selfProxy != null
                        ? selfProxy.upsertCollaboratorAndPersist(actorId, documentId, request)
                        : upsertCollaboratorAndPersist(actorId, documentId, request);
            } catch (DataIntegrityViolationException ex) {
                attempt++;
                if (attempt >= MAX_ORDER_UPSERT_ATTEMPTS) {
                    throw ex;
                }
            }
        }
    }

    /**
     * Adds or updates a collaborator on a document.
     */
    @Transactional
    public CollaboratorResponse upsertCollaboratorAndPersist(
            UUID actorId, UUID documentId, CollaboratorUpsertRequest request) {
        Document doc = permissionService.requireSharingAdminAccess(actorId, documentId);
        DocumentAccessLevel requestedLevel = normalizeCollaboratorAccess(request.accessLevel());

        User targetUser = userRepository
                .findByEmail(request.email().strip().toLowerCase())
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "User not found for the provided email."));

        if (targetUser.getId().equals(doc.getUser().getId())) {
            throw new ApiException(ErrorCode.CONFLICT, "Document owner already has owner access.");
        }

        if (targetUser.getId().equals(actorId)) {
            throw new ApiException(ErrorCode.CONFLICT, "Cannot modify own collaborator access.");
        }

        DocumentCollaborator collaborator = collaboratorRepository
                .findByDocument_IdAndUser_Id(documentId, targetUser.getId())
                .orElseGet(() -> DocumentCollaborator.builder()
                        .document(doc)
                        .user(targetUser)
                        .build());

        collaborator.setAccessLevel(requestedLevel);
        User actor = actorId.equals(doc.getUser().getId())
                ? doc.getUser()
                : userRepository
                        .findById(actorId)
                        .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Acting user not found."));
        collaborator.setGrantedBy(actor);

        DocumentCollaborator saved = collaboratorRepository.save(collaborator);

        // Ensure the collaborator has a UserDocumentOrder entry for their Shared
        // section so root documents and floated nested documents can be reordered.
        ensureCollaboratorOrder(doc, targetUser);

        return new CollaboratorResponse(
                saved.getUser().getId(),
                saved.getUser().getEmail(),
                saved.getUser().getDisplayName(),
                saved.getAccessLevel(),
                saved.getCreatedAt(),
                false);
    }

    @Transactional
    public CollaboratorResponse updateCollaboratorAccess(
            UUID actorId, UUID documentId, UUID collaboratorUserId, CollaboratorAccessUpdateRequest request) {
        Document doc = permissionService.requireSharingAdminAccess(actorId, documentId);

        if (doc.getUser().getId().equals(collaboratorUserId)) {
            throw new ApiException(ErrorCode.CONFLICT, "Owner access cannot be changed.");
        }

        if (actorId.equals(collaboratorUserId)) {
            throw new ApiException(ErrorCode.CONFLICT, "Cannot modify own collaborator access.");
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
                saved.getCreatedAt(),
                false);
    }

    @Transactional
    public void removeCollaborator(UUID actorId, UUID documentId, UUID collaboratorUserId) {
        Document doc = permissionService.requireSharingAdminAccess(actorId, documentId);

        if (doc.getUser().getId().equals(collaboratorUserId)) {
            throw new ApiException(ErrorCode.CONFLICT, "Owner cannot be removed from collaborators.");
        }

        if (actorId.equals(collaboratorUserId)) {
            throw new ApiException(ErrorCode.CONFLICT, "Cannot remove yourself as collaborator. Use leave instead.");
        }

        boolean exists = collaboratorRepository.existsByDocument_IdAndUser_Id(documentId, collaboratorUserId);
        if (!exists) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }

        collaboratorRepository.deleteByDocument_IdAndUser_Id(documentId, collaboratorUserId);
        userDocumentOrderRepository.deleteByUser_IdAndDocument_Id(collaboratorUserId, documentId);
    }

    @Transactional
    public void leaveSharedDocument(UUID userId, UUID documentId) {
        Document doc = permissionService.requireReadAccessIncludingTrash(userId, documentId);

        if (doc.getUser().getId().equals(userId)) {
            throw new ApiException(ErrorCode.CONFLICT, "Owners cannot leave their own documents.");
        }

        boolean exists = collaboratorRepository.existsByDocument_IdAndUser_Id(documentId, userId);
        if (!exists) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }

        collaboratorRepository.deleteByDocument_IdAndUser_Id(documentId, userId);
        userDocumentOrderRepository.deleteByUser_IdAndDocument_Id(userId, documentId);
    }

    @Transactional(readOnly = true)
    public SharingSettingsResponse getSharingSettings(UUID actorId, UUID documentId) {
        Document doc = permissionService.requireSharingAdminAccess(actorId, documentId);
        boolean hasActiveLink = doc.getGeneralAccessMode() == DocumentGeneralAccessMode.ANYONE_WITH_LINK;

        return new SharingSettingsResponse(doc.getGeneralAccessMode(), doc.getLinkAccessLevel(), hasActiveLink);
    }

    @Transactional
    public SharingSettingsResponse updateSharingSettings(
            UUID actorId, UUID documentId, SharingSettingsUpdateRequest request) {
        Document doc = permissionService.requireSharingAdminAccess(actorId, documentId);

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
    public DocumentAccessResponse getMyAccess(UUID userId, UUID documentId) {
        Document active =
                documentRepository.findByIdAndDeletedAtIsNull(documentId).orElse(null);
        if (active != null) {
            return computeActiveAccess(userId, documentId, active);
        }

        // Trashed documents: report the caller's pre-trash access so the UI can offer a
        // read-only trash view (any level) versus manage actions (EDIT and above).
        // `owner` means direct ownership only, matching the active path above — an
        // OWNER-level collaborator reports accessLevel=OWNER with owner=false.
        DocumentAccessLevel trashAccess = permissionService.resolveTrashAccess(userId, documentId);
        if (trashAccess == null) {
            return new DocumentAccessResponse(documentId, false, null, false, true);
        }
        boolean owner = documentRepository
                .findById(documentId)
                .map(doc -> doc.getUser().getId().equals(userId))
                .orElse(false);
        return new DocumentAccessResponse(documentId, true, trashAccess, owner, true);
    }

    @Transactional(readOnly = true)
    public DocumentAccessResponse accessCheck(UUID userId, UUID documentId) {
        return computeAccess(userId, documentId);
    }

    private void ensureCollaboratorOrder(Document doc, User targetUser) {
        if (userDocumentOrderRepository.existsByUser_IdAndDocument_Id(targetUser.getId(), doc.getId())) {
            return;
        }
        String minKey = userDocumentOrderRepository
                .findMinOrderKeyByUserId(targetUser.getId(), doc.getId())
                .filter(FractionalIndex::isValidOrderKey)
                .orElse(null);
        UserDocumentOrder udo = UserDocumentOrder.builder()
                .user(targetUser)
                .document(doc)
                .orderKey(FractionalIndex.keyBetween(null, minKey))
                .build();
        userDocumentOrderRepository.saveAndFlush(udo);
    }

    private DocumentAccessResponse computeAccess(UUID userId, UUID documentId) {
        Document doc = documentRepository.findByIdAndDeletedAtIsNull(documentId).orElse(null);
        if (doc == null) {
            // Strict: realtime connection gating relies on trashed documents being denied here.
            return new DocumentAccessResponse(documentId, false, null, false, true);
        }
        return computeActiveAccess(userId, documentId, doc);
    }

    private DocumentAccessResponse computeActiveAccess(UUID userId, UUID documentId, Document doc) {
        boolean isOwner = doc.getUser().getId().equals(userId);
        if (isOwner) {
            return new DocumentAccessResponse(documentId, true, DocumentAccessLevel.OWNER, true, false);
        }

        DocumentAccessLevel level = permissionService.resolveAccess(userId, documentId);
        if (level == null) {
            return new DocumentAccessResponse(documentId, false, null, false, false);
        }
        return new DocumentAccessResponse(documentId, true, level, false, false);
    }

    private static DocumentAccessLevel normalizeCollaboratorAccess(DocumentAccessLevel accessLevel) {
        if (accessLevel == null) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "accessLevel is required.");
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
}
