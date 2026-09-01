package com.nextdocs.api.document.service;

import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.repository.DocumentRepository;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Authoritative service to resolve effective permissions and enforce access control.
 * It replaces direct ownership/collaborator lookups with ancestor-walk resolution.
 */
@Service
@RequiredArgsConstructor
public class PermissionService {

    private final DocumentRepository documentRepository;

    /**
     * Resolves the effective access level of a user for a document.
     * Walks up the ancestor chain (closest-ancestor-wins).
     *
     * @return the resolved access level, or null if no access is granted
     */
    @Transactional(readOnly = true)
    public DocumentAccessLevel resolveAccess(UUID userId, UUID documentId) {
        String raw = documentRepository.resolveEffectiveAccess(userId, documentId);
        if (raw == null) {
            return null;
        }
        return DocumentAccessLevel.valueOf(raw);
    }

    /**
     * Enforces that the user has at least VIEW (read) access to the document.
     * Masking forbidden as not found to protect document existence privacy.
     *
     * @return the Document if accessible
     */
    @Transactional(readOnly = true)
    public Document requireReadAccess(UUID userId, UUID documentId) {
        Document doc = documentRepository
                .findByIdAndDeletedAtIsNull(documentId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));

        DocumentAccessLevel access = resolveAccess(userId, documentId);
        if (access == null) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
        return doc;
    }

    /**
     * Enforces that the user has at least EDIT access to the document.
     *
     * @return the Document if editable
     */
    @Transactional(readOnly = true)
    public Document requireEditAccess(UUID userId, UUID documentId) {
        Document doc = documentRepository
                .findByIdAndDeletedAtIsNull(documentId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));

        DocumentAccessLevel access = resolveAccess(userId, documentId);
        if (access == null) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
        if (!access.allowsEdit()) {
            throw new ApiException(ErrorCode.FORBIDDEN);
        }
        return doc;
    }

    /**
     * Enforces that the user is the direct owner of the document (no ancestor walk).
     * Administrative settings (e.g. sharing settings, collaborator edits) must be restricted
     * to the direct owner of the specific page.
     *
     * @return the Document if owned
     */
    @Transactional(readOnly = true)
    public Document requireOwnerAccess(UUID userId, UUID documentId) {
        return documentRepository
                .findByIdAndUser_IdAndDeletedAtIsNull(documentId, userId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
    }

    /**
     * Enforces direct ownership regardless of trash state. Sharing administration stays
     * available while a document is in trash so owners can still manage collaborator access.
     *
     * @return the Document if owned, whether trashed or not
     */
    @Transactional(readOnly = true)
    public Document requireOwnerAccessIncludingTrash(UUID userId, UUID documentId) {
        return documentRepository
                .findByIdAndUser_Id(documentId, userId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
    }

    /**
     * Read access for active documents via the normal access chain; ownership-only fallback
     * for trashed documents (e.g. viewing the collaborator list of a trashed document).
     *
     * @return the Document if readable under either rule
     */
    @Transactional(readOnly = true)
    public Document requireReadAccessOrTrashOwner(UUID userId, UUID documentId) {
        Document active =
                documentRepository.findByIdAndDeletedAtIsNull(documentId).orElse(null);
        if (active != null) {
            DocumentAccessLevel access = resolveAccess(userId, documentId);
            if (access == null) {
                throw new ApiException(ErrorCode.NOT_FOUND);
            }
            return active;
        }
        return documentRepository
                .findByIdAndUser_Id(documentId, userId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
    }

    /**
     * Resolves the effective access level of a user for a document in the trash scope,
     * i.e. including soft-deleted documents. Mirrors {@link #resolveAccess(UUID, UUID)}
     * so permissions held before a document was trashed remain valid for
     * trash management (viewing trash state, restoring, permanently deleting).
     *
     * @return the resolved access level, or null if no access is granted
     */
    @Transactional(readOnly = true)
    public DocumentAccessLevel resolveTrashAccess(UUID userId, UUID documentId) {
        String raw = documentRepository.resolveTrashAccess(userId, documentId);
        if (raw == null) {
            return null;
        }
        return DocumentAccessLevel.valueOf(raw);
    }

    /**
     * Enforces that the user has at least EDIT-level access to a document in the trash scope.
     * Owners and EDIT collaborators may manage trashed documents; VIEW/COMMENT grants are rejected.
     *
     * @return the Document regardless of trash state
     */
    @Transactional(readOnly = true)
    public Document requireTrashEditAccess(UUID userId, UUID documentId) {
        Document doc = documentRepository.findById(documentId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));

        DocumentAccessLevel access = resolveTrashAccess(userId, documentId);
        if (access == null) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
        if (!access.allowsEdit()) {
            throw new ApiException(ErrorCode.FORBIDDEN);
        }
        return doc;
    }
}
