package com.nextdocs.api.attachment.service;

import com.nextdocs.api.attachment.AttachmentScope;
import com.nextdocs.api.attachment.entity.Attachment;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.service.PermissionService;
import com.nextdocs.api.workspace.service.WorkspaceAccessService;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * The single authorization switch for attachments.
 *
 * <p>Uploads and downloads are gated per scope, so the storage lifecycle (sniffing,
 * quota, hashing, signing, deletes) never branches on scope and a new scope only
 * adds a branch here:
 * <ul>
 *   <li>document uploads need EDIT access and downloads follow the document access
 *       rules, including trash and anonymous share links;</li>
 *   <li>workspace uploads are owner-only and downloads require the caller to be a
 *       member of the owning workspace. Anonymous callers are masked as 404: a
 *       workspace icon is never part of a share-link surface.</li>
 * </ul>
 */
@Component
@RequiredArgsConstructor
public class AttachmentAccessPolicy {

    private final PermissionService permissionService;
    private final WorkspaceAccessService workspaceAccessService;

    /** Enforces that the actor may add files to the scope. */
    public void requireUpload(UUID actorId, AttachmentScope scope) {
        switch (scope.kind()) {
            case DOCUMENT -> permissionService.requireEditAccess(actorId, scope.id());
            case WORKSPACE -> {
                UUID callerWorkspaceId = requireWorkspaceUpload(actorId);
                if (!callerWorkspaceId.equals(scope.id())) {
                    throw new ApiException(ErrorCode.NOT_FOUND);
                }
            }
        }
    }

    /**
     * Resolves the caller's own workspace for an upload. Returning the id lets a
     * workspace upload build its scope without looking the membership up again.
     */
    public UUID requireWorkspaceUpload(UUID actorId) {
        return workspaceAccessService.requireOwner(actorId).workspace().getId();
    }

    /**
     * Enforces that the caller may resolve a signed URL for {@code attachment}.
     *
     * @param userId caller id, or {@code null} for anonymous viewers (public documents only)
     */
    public void requireDownload(UUID userId, Attachment attachment) {
        if (attachment.getDocument() != null) {
            requireDocumentDownload(userId, attachment.getDocument());
            return;
        }
        if (userId == null) {
            // Workspace attachments have no anonymous surface: masking as not found
            // keeps their existence out of reach of share-link visitors.
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
        UUID callerWorkspaceId =
                workspaceAccessService.requireMember(userId).workspace().getId();
        if (!callerWorkspaceId.equals(attachment.getWorkspace().getId())) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
    }

    private void requireDocumentDownload(UUID userId, Document document) {
        if (document.getDeletedAt() != null) {
            // Trashed documents stay readable (read-only) only for callers in the trash access
            // chain; anonymous viewers never see them, matching GET /documents/{id}.
            if (userId == null || permissionService.resolveTrashAccess(userId, document.getId()) == null) {
                throw new ApiException(ErrorCode.NOT_FOUND);
            }
            return;
        }
        if (userId == null) {
            // Anonymous viewers resolve through the effective (possibly inherited) share-link
            // grant, matching GET /documents/{id}/public and access-check. Checking only the
            // owning document's own generalAccessMode would 404 attachments on children of a
            // shared folder.
            if (permissionService.resolvePublicAccess(document.getId()) == null) {
                throw new ApiException(ErrorCode.NOT_FOUND);
            }
            return;
        }
        if (permissionService.resolveAccess(userId, document.getId()) == null) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
    }
}
