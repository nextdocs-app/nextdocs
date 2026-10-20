package com.nextdocs.api.document.dto.response;

import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.workspace.dto.response.WorkspaceBrandingResponse;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.OffsetDateTime;
import java.util.UUID;

@Schema(description = "Document response")
public record DocumentResponse(
        @Schema(description = "Document ID") UUID id,
        @Schema(description = "Document title") String title,

        @Schema(description = "Base64-encoded Yjs state when requested")
        String yjsState,

        @Schema(description = "Parent document ID, null for root-level")
        UUID parentId,

        @Schema(
                description = "Space this root page is filed into; null for Private and Shared pages. "
                        + "Nested pages do not repeat the space: walk to the root.")
        UUID spaceId,

        @Schema(description = "Fractional ordering key") String orderKey,

        @Schema(description = "Whether this document has active non-trashed children")
        boolean hasChildren,

        @Schema(description = "Whether this document has external collaborators")
        boolean hasCollaborators,

        @Schema(description = "Effective access level of the requesting user")
        DocumentAccessLevel accessLevel,

        @Schema(description = "Creator label") String createdBy,
        @Schema(description = "Creation timestamp") OffsetDateTime createdAt,
        @Schema(description = "Last update timestamp") OffsetDateTime updatedAt,

        @Schema(description = "When the document was moved to trash, if applicable")
        OffsetDateTime deletedAt,

        @Schema(description = "When the document will be permanently removed (trash retention)")
        OffsetDateTime purgeAt,

        @Schema(description = "Page icon, null when the document has none")
        DocumentIconResponse icon,

        @Schema(description = "Cover image, null when the document has none")
        DocumentCoverResponse cover,

        @Schema(
                description =
                        "Workspace name and icon for anonymous share pages; null on " + "authenticated and list reads")
        WorkspaceBrandingResponse workspace) {

    /**
     * Member and list projection: workspace branding is only disclosed on a public share
     * page, so everything that is not {@code GET /api/v1/documents/{id}/public} calls this
     * factory instead of passing a null branding argument at each construction.
     *
     * <p>This overload carries no space: Private and Shared pages, and every test fixture.
     */
    public static DocumentResponse withoutBranding(
            UUID id,
            String title,
            String yjsState,
            UUID parentId,
            String orderKey,
            boolean hasChildren,
            boolean hasCollaborators,
            DocumentAccessLevel accessLevel,
            String createdBy,
            OffsetDateTime createdAt,
            OffsetDateTime updatedAt,
            OffsetDateTime deletedAt,
            OffsetDateTime purgeAt,
            DocumentIconResponse icon,
            DocumentCoverResponse cover) {
        return withoutBranding(
                id,
                title,
                yjsState,
                parentId,
                orderKey,
                hasChildren,
                hasCollaborators,
                accessLevel,
                createdBy,
                createdAt,
                updatedAt,
                deletedAt,
                purgeAt,
                icon,
                cover,
                null);
    }

    /** As above, carrying the space a root page is filed into. */
    public static DocumentResponse withoutBranding(
            UUID id,
            String title,
            String yjsState,
            UUID parentId,
            String orderKey,
            boolean hasChildren,
            boolean hasCollaborators,
            DocumentAccessLevel accessLevel,
            String createdBy,
            OffsetDateTime createdAt,
            OffsetDateTime updatedAt,
            OffsetDateTime deletedAt,
            OffsetDateTime purgeAt,
            DocumentIconResponse icon,
            DocumentCoverResponse cover,
            UUID spaceId) {
        return new DocumentResponse(
                id,
                title,
                yjsState,
                parentId,
                spaceId,
                orderKey,
                hasChildren,
                hasCollaborators,
                accessLevel,
                createdBy,
                createdAt,
                updatedAt,
                deletedAt,
                purgeAt,
                icon,
                cover,
                null);
    }
}
