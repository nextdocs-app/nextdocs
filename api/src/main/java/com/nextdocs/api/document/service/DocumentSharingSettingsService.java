package com.nextdocs.api.document.service;

import com.nextdocs.api.audit.entity.AccessAuditAction;
import com.nextdocs.api.audit.service.AccessAuditService;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.dto.request.SharingSettingsUpdateRequest;
import com.nextdocs.api.document.dto.response.SharingSettingsResponse;
import com.nextdocs.api.document.dto.response.SharingSourceKind;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.entity.DocumentGeneralAccessMode;
import com.nextdocs.api.document.entity.DocumentWorkspaceAccessMode;
import com.nextdocs.api.document.repository.AccessGrantRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.realtime.event.DocumentAccessChangedEvent;
import com.nextdocs.api.space.entity.Space;
import com.nextdocs.api.space.entity.SpaceAccessMode;
import com.nextdocs.api.space.service.SpaceAccessService;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The sharing-settings projection: link, workspace audience, and their provenance.
 *
 * <p>Separate from {@link DocumentSharingService} because reading/updating settings is a
 * different job from composing the collaborator roster and mutating rows. Both use the
 * same {@link SharingDocuments} ancestor walk, so the panel and the resolver agree on
 * which ancestors are reachable.
 */
@Service
@RequiredArgsConstructor
public class DocumentSharingSettingsService {

    private final DocumentRepository documentRepository;
    private final AccessGrantRepository accessGrantRepository;
    private final PermissionService permissionService;
    private final AccessAuditService auditService;
    private final SharedSectionService sharedSectionService;
    private final SpaceAccessService spaceAccessService;
    private final ApplicationEventPublisher eventPublisher;

    @Transactional(readOnly = true)
    public SharingSettingsResponse getSharingSettings(UUID actorId, UUID documentId) {
        // Settings are readable by anyone who may see the page's roster. The panel shows
        // the resolved audiences read-only to those readers; writes still require
        // requireSharingAdminAccess in updateSharingSettings.
        Document doc = permissionService.requireReadAccessIncludingTrash(actorId, documentId);
        permissionService.requireRosterAccess(actorId, doc);
        return projectSharingSettings(actorId, doc);
    }

    /** The settings projection for a document whose caller has already been authorized. */
    private SharingSettingsResponse projectSharingSettings(UUID actorId, Document doc) {
        boolean hasActiveLink = isLiveLink(doc);

        // The nearest reachable ancestor link grant drives every case below, including
        // the "Blocked from X" and "Overrides X" provenance the panel shows.
        Optional<LinkGrant> nearestGrant = findNearestLinkGrant(doc);
        UUID grantDocumentId = nearestGrant.map(LinkGrant::docId).orElse(null);
        String grantTitle = nearestGrant.map(LinkGrant::title).orElse(null);
        if (grantDocumentId != null
                && !permissionService
                        .resolveIdentityAccessBatch(actorId, List.of(grantDocumentId))
                        .containsKey(grantDocumentId)) {
            grantDocumentId = null;
            grantTitle = null;
        }
        WorkspaceGrantView workspace = workspaceGrantView(actorId, doc);

        if (hasActiveLink) {
            // Own link overrides ancestor grants (closest-ancestor-wins), and wins
            // over an own block: surface the ancestor source if present so UI shows overrides.
            return response(doc, true, false, grantDocumentId, grantTitle, false, workspace);
        }

        if (doc.isLinkInheritBlocked()) {
            // Own block shadows every ancestor grant (mirrors a NO_ACCESS
            // breakpoint): the document is effectively private on the link
            // channel regardless of ancestors.
            return response(doc, false, false, grantDocumentId, grantTitle, true, workspace);
        }

        if (nearestGrant.isPresent()) {
            return response(
                    doc,
                    false,
                    true,
                    grantDocumentId,
                    grantTitle,
                    false,
                    workspace,
                    // The child's own link level only takes effect when its own mode is
                    // ANYONE_WITH_LINK; here the ancestor's level is the effective one.
                    nearestGrant.get().linkAccessLevel());
        }

        return response(doc, false, false, null, null, false, workspace);
    }

    private static SharingSettingsResponse response(
            Document doc,
            boolean hasActiveLink,
            boolean inherited,
            UUID inheritedFromId,
            String inheritedFromTitle,
            boolean linkInheritBlocked,
            WorkspaceGrantView workspace) {
        return response(
                doc,
                hasActiveLink,
                inherited,
                inheritedFromId,
                inheritedFromTitle,
                linkInheritBlocked,
                workspace,
                doc.getLinkAccessLevel());
    }

    private static SharingSettingsResponse response(
            Document doc,
            boolean hasActiveLink,
            boolean inherited,
            UUID inheritedFromId,
            String inheritedFromTitle,
            boolean linkInheritBlocked,
            WorkspaceGrantView workspace,
            DocumentAccessLevel linkAccessLevel) {
        return new SharingSettingsResponse(
                doc.getGeneralAccessMode(),
                linkAccessLevel,
                hasActiveLink,
                inherited,
                inheritedFromId,
                inheritedFromTitle,
                linkInheritBlocked,
                doc.getLinkExpiresAt(),
                doc.getWorkspaceAccessMode(),
                workspace.level(),
                workspace.blocked(),
                workspace.inherited(),
                workspace.inheritedFromKind(),
                workspace.inheritedFromId(),
                workspace.inheritedFromTitle());
    }

    private static boolean isLiveLink(Document doc) {
        return doc.getGeneralAccessMode() == DocumentGeneralAccessMode.ANYONE_WITH_LINK
                && (doc.getLinkExpiresAt() == null || doc.getLinkExpiresAt().isAfter(OffsetDateTime.now()));
    }

    /**
     * Nearest reachable ancestor that holds its own ANYONE_WITH_LINK grant, for the
     * inherited and shadowed-grant display paths.
     *
     * Reachable mirrors resolve_public_access: trashed ancestors stop resolution (grants
     * above the trash bundle never apply) and a blocked ancestor shadows everything above
     * it, so nothing below can inherit or shadow a grant from higher up. An expired own
     * link is not a grant and does not stop the walk.
     */
    private Optional<LinkGrant> findNearestLinkGrant(Document doc) {
        for (Document ancestor : SharingDocuments.loadReachableAncestors(documentRepository, doc)) {
            if (isLiveLink(ancestor)) {
                return Optional.of(new LinkGrant(
                        ancestor.getId(), SharingDocuments.titleOrUntitled(ancestor), ancestor.getLinkAccessLevel()));
            }
            if (ancestor.isLinkInheritBlocked()) {
                return Optional.empty();
            }
        }
        return Optional.empty();
    }

    /**
     * Workspace-audience provenance for the panel. A block shadows ancestor grants; an
     * own WORKSPACE_MEMBERS setting overrides them; otherwise the nearest ancestor grant
     * is the effective one. The stored level is returned when nothing applies so the
     * panel can render the setting the page would use if enabled.
     *
     * <p>A public space is that ancestor for the pages it anchors. The space is a
     * permission container, so its everyone level inherits and is overridden exactly like
     * an ancestor page's audience; only the source it names differs.
     *
     * <p>The source is named only when the caller can see it, mirroring the link panel: a
     * page they cannot open, or a space they cannot find, must not be confirmed here.
     */
    private WorkspaceGrantView workspaceGrantView(UUID actorId, Document doc) {
        Optional<WorkspaceGrant> nearest = findNearestWorkspaceGrant(doc);
        WorkspaceGrantView view = workspaceGrantState(doc, nearest);
        if (nearest.isPresent() && !canSeeSource(actorId, nearest.get())) {
            // Keep the state and the level: what the page inherits is not a secret, only
            // which page or space supplies it is.
            return new WorkspaceGrantView(view.level(), view.blocked(), view.inherited(), null, null, null);
        }
        return view;
    }

    /**
     * Mode, block and nearest source turned into the panel's view. A block and an own
     * setting still name the source they shadow or override, so the UI can offer
     * "Inherit from X" instead of a dead "Blocked" row.
     */
    private static WorkspaceGrantView workspaceGrantState(Document doc, Optional<WorkspaceGrant> nearest) {
        if (doc.isWorkspaceInheritBlocked()) {
            return new WorkspaceGrantView(
                    doc.getWorkspaceAccessLevel(),
                    true,
                    false,
                    nearest.map(WorkspaceGrant::kind).orElse(null),
                    nearest.map(WorkspaceGrant::id).orElse(null),
                    nearest.map(WorkspaceGrant::title).orElse(null));
        }
        if (doc.getWorkspaceAccessMode() == DocumentWorkspaceAccessMode.WORKSPACE_MEMBERS) {
            return new WorkspaceGrantView(
                    doc.getWorkspaceAccessLevel(),
                    false,
                    false,
                    nearest.map(WorkspaceGrant::kind).orElse(null),
                    nearest.map(WorkspaceGrant::id).orElse(null),
                    nearest.map(WorkspaceGrant::title).orElse(null));
        }
        if (nearest.isPresent()) {
            return new WorkspaceGrantView(
                    nearest.get().level(),
                    false,
                    true,
                    nearest.get().kind(),
                    nearest.get().id(),
                    nearest.get().title());
        }
        return new WorkspaceGrantView(doc.getWorkspaceAccessLevel(), false, false, null, null, null);
    }

    /**
     * Whether the caller may be told which page or space supplies their workspace access.
     * A page answers through the identity resolver; a space answers through the same
     * "can this caller find it in navigation" rule the breadcrumb uses.
     */
    private boolean canSeeSource(UUID actorId, WorkspaceGrant grant) {
        if (grant.kind() == SharingSourceKind.SPACE) {
            return spaceAccessService
                    .visibleSpaceIds(actorId, List.of(grant.space()))
                    .contains(grant.id());
        }
        return permissionService
                .resolveIdentityAccessBatch(actorId, List.of(grant.id()))
                .containsKey(grant.id());
    }

    /**
     * Nearest reachable ancestor with workspace general access, stopping at a block. A
     * public space's everyone level is the outermost such ancestor, above the space root,
     * so every page in the chain can override or block it.
     */
    private Optional<WorkspaceGrant> findNearestWorkspaceGrant(Document doc) {
        List<Document> ancestors = SharingDocuments.loadReachableAncestors(documentRepository, doc);
        for (Document ancestor : ancestors) {
            if (ancestor.isWorkspaceInheritBlocked()) {
                return Optional.empty();
            }
            if (ancestor.getWorkspaceAccessMode() == DocumentWorkspaceAccessMode.WORKSPACE_MEMBERS) {
                return Optional.of(new WorkspaceGrant(
                        SharingSourceKind.PAGE,
                        ancestor.getId(),
                        SharingDocuments.titleOrUntitled(ancestor),
                        ancestor.getWorkspaceAccessLevel(),
                        null));
            }
        }
        // Only the page or the reachable ancestors can supply the space: resolveSpace(doc)
        // walks parents without the trash stop, so it could reach a space above a trashed
        // bundle whose audience no longer governs this page.
        Space space = doc.getSpace() != null
                ? doc.getSpace()
                : ancestors.stream()
                        .map(Document::getSpace)
                        .filter(Objects::nonNull)
                        .findFirst()
                        .orElse(null);
        if (space != null
                && space.getAccessMode() == SpaceAccessMode.PUBLIC
                && space.getEveryoneAccessLevel() != null) {
            return Optional.of(new WorkspaceGrant(
                    SharingSourceKind.SPACE, space.getId(), space.getName(), space.getEveryoneAccessLevel(), space));
        }
        return Optional.empty();
    }

    @Transactional
    public SharingSettingsResponse updateSharingSettings(
            UUID actorId, UUID documentId, SharingSettingsUpdateRequest request) {
        Document doc = permissionService.requireSharingAdminAccess(actorId, documentId);

        DocumentGeneralAccessMode mode =
                request.generalAccessMode() != null ? request.generalAccessMode() : doc.getGeneralAccessMode();
        if (request.generalAccessMode() != null) {
            doc.setGeneralAccessMode(mode);
        }
        if (mode == DocumentGeneralAccessMode.ANYONE_WITH_LINK
                && request.generalAccessMode() != null
                && request.linkAccessLevel() == null) {
            throw new ApiException(
                    ErrorCode.VALIDATION_FAILED,
                    "linkAccessLevel is required when generalAccessMode is ANYONE_WITH_LINK.");
        }
        if (mode != DocumentGeneralAccessMode.ANYONE_WITH_LINK
                && (request.linkAccessLevel() != null
                        || request.linkExpiresAt() != null
                        || Boolean.TRUE.equals(request.clearLinkExpiresAt()))) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Link settings require ANYONE_WITH_LINK mode.");
        }
        if (mode == DocumentGeneralAccessMode.ANYONE_WITH_LINK && Boolean.TRUE.equals(request.linkInheritBlocked())) {
            throw new ApiException(
                    ErrorCode.VALIDATION_FAILED,
                    "linkInheritBlocked must be omitted or false when generalAccessMode is ANYONE_WITH_LINK.");
        }

        if (request.linkAccessLevel() != null) {
            doc.setLinkAccessLevel(normalizeLinkAccess(request.linkAccessLevel()));
        }
        if (mode == DocumentGeneralAccessMode.ANYONE_WITH_LINK) {
            // An own link always wins by closest-ancestor-wins, so a stored
            // block would be dead state: clear it like a direct collaborator
            // row overwriting a NO_ACCESS breakpoint.
            if (request.generalAccessMode() == DocumentGeneralAccessMode.ANYONE_WITH_LINK) {
                doc.setLinkInheritBlocked(false);
            }
            if (Boolean.TRUE.equals(request.clearLinkExpiresAt()) && request.linkExpiresAt() != null) {
                throw new ApiException(
                        ErrorCode.VALIDATION_FAILED, "linkExpiresAt and clearLinkExpiresAt cannot be used together.");
            }
            // An omitted expiry leaves the current value alone; a separate flag
            // makes clearing explicit, including on a workspace-only PATCH.
            if (Boolean.TRUE.equals(request.clearLinkExpiresAt())) {
                doc.setLinkExpiresAt(null);
            } else if (request.linkExpiresAt() != null) {
                if (!request.linkExpiresAt().isAfter(OffsetDateTime.now())) {
                    throw new ApiException(ErrorCode.VALIDATION_FAILED, "linkExpiresAt must be in the future.");
                }
                doc.setLinkExpiresAt(request.linkExpiresAt());
            }
        } else {
            if (request.linkInheritBlocked() != null) {
                doc.setLinkInheritBlocked(request.linkInheritBlocked());
            }
            // The link is off: an expiry would be dead state and would silently
            // shorten a link the owner later recreates.
            doc.setLinkExpiresAt(null);
        }
        if (doc.isLinkInheritBlocked()
                && doc.getGeneralAccessMode() == DocumentGeneralAccessMode.RESTRICTED
                && findNearestLinkGrant(doc).isEmpty()) {
            // A block without an ancestor grant denies nothing (mirrors a
            // NO_ACCESS row with no ancestor grant, which is deleted instead of
            // stored): normalize so the flag always implies a shadowed grant.
            doc.setLinkInheritBlocked(false);
        }

        applyWorkspaceSettings(doc, request);

        documentRepository.save(doc);
        eventPublisher.publishEvent(new DocumentAccessChangedEvent(documentId));
        auditService.recordDocument(
                doc,
                actorId,
                AccessAuditAction.SHARING_SETTINGS_UPDATE,
                null,
                null,
                "general=" + doc.getGeneralAccessMode()
                        + ",link=" + doc.getLinkAccessLevel()
                        + ",linkExpiresAt=" + doc.getLinkExpiresAt()
                        + ",workspace=" + doc.getWorkspaceAccessMode()
                        + ",workspaceLevel=" + doc.getWorkspaceAccessLevel());
        // Return full provenance (inherited / Overrides) so the UI can
        // immediately show override badges without a reload.
        return projectSharingSettings(actorId, doc);
    }

    /**
     * A standalone root with an audience is listed in the owner's Shared section. Giving
     * it a Shared position up front keeps it at the top of that section, like a root
     * shared with a person through a grant; without a row it sorts below every keyed entry
     * until the owner drags it there. The row is never removed when the audience goes away,
     * so re-sharing returns the page to the position it had.
     */
    private void ensureOwnerSharedPosition(Document doc) {
        if (doc.getParent() != null || doc.getSpace() != null) {
            return;
        }
        // Every owner gets a position, not just the creator: ownership is a grant row.
        for (var grant : accessGrantRepository.findPositiveUserGrantsByDocumentId(doc.getId())) {
            if (grant.getAccessLevel() == DocumentAccessLevel.OWNER) {
                sharedSectionService.ensureOrderRow(grant.getUser(), doc);
            }
        }
    }

    /**
     * Applies the workspace-audience half of a sharing update. Mode, level, and block
     * are validated together here because only the loaded document knows whether a
     * level or block is meaningful for the current mode.
     */
    private void applyWorkspaceSettings(Document doc, SharingSettingsUpdateRequest request) {
        DocumentWorkspaceAccessMode requestedMode = request.workspaceAccessMode();
        if (requestedMode == DocumentWorkspaceAccessMode.WORKSPACE_MEMBERS) {
            if (Boolean.TRUE.equals(request.workspaceInheritBlocked())) {
                throw new ApiException(
                        ErrorCode.VALIDATION_FAILED,
                        "workspaceInheritBlocked must be omitted or false when workspaceAccessMode is WORKSPACE_MEMBERS.");
            }
            doc.setWorkspaceAccessMode(DocumentWorkspaceAccessMode.WORKSPACE_MEMBERS);
            doc.setWorkspaceAccessLevel(normalizeWorkspaceAccess(request.workspaceAccessLevel()));
            doc.setWorkspaceInheritBlocked(false);
            ensureOwnerSharedPosition(doc);
        } else if (requestedMode == DocumentWorkspaceAccessMode.RESTRICTED) {
            if (request.workspaceAccessLevel() != null) {
                throw new ApiException(
                        ErrorCode.VALIDATION_FAILED,
                        "workspaceAccessLevel must be omitted unless workspaceAccessMode is WORKSPACE_MEMBERS.");
            }
            doc.setWorkspaceAccessMode(DocumentWorkspaceAccessMode.RESTRICTED);
            if (request.workspaceInheritBlocked() != null) {
                doc.setWorkspaceInheritBlocked(request.workspaceInheritBlocked());
            }
        } else {
            if (request.workspaceAccessLevel() != null) {
                if (doc.getWorkspaceAccessMode() != DocumentWorkspaceAccessMode.WORKSPACE_MEMBERS) {
                    throw new ApiException(
                            ErrorCode.VALIDATION_FAILED,
                            "workspaceAccessLevel is only valid while workspace access is enabled.");
                }
                doc.setWorkspaceAccessLevel(normalizeWorkspaceAccess(request.workspaceAccessLevel()));
            }
            if (request.workspaceInheritBlocked() != null) {
                if (doc.getWorkspaceAccessMode() == DocumentWorkspaceAccessMode.WORKSPACE_MEMBERS
                        && request.workspaceInheritBlocked()) {
                    throw new ApiException(
                            ErrorCode.VALIDATION_FAILED,
                            "workspaceInheritBlocked must be false while workspace access is enabled.");
                }
                doc.setWorkspaceInheritBlocked(request.workspaceInheritBlocked());
            }
        }

        if (doc.isWorkspaceInheritBlocked()
                && doc.getWorkspaceAccessMode() == DocumentWorkspaceAccessMode.RESTRICTED
                && findNearestWorkspaceGrant(doc).isEmpty()) {
            // Same normalization as the link block: a block with no ancestor grant
            // shadows nothing and would misreport the page as restricted from an
            // ancestor that never shared. A public space counts as such an ancestor, so
            // a page in one keeps the block that turns the space audience off.
            doc.setWorkspaceInheritBlocked(false);
        }
    }

    private static DocumentAccessLevel normalizeWorkspaceAccess(DocumentAccessLevel accessLevel) {
        if (accessLevel == null) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "workspaceAccessLevel is required.");
        }
        if (accessLevel == DocumentAccessLevel.OWNER || accessLevel == DocumentAccessLevel.NO_ACCESS) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "workspaceAccessLevel must be VIEW, COMMENT, or EDIT.");
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
        if (accessLevel == DocumentAccessLevel.NO_ACCESS) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "NO_ACCESS is not allowed for share links.");
        }
        return accessLevel;
    }

    private record LinkGrant(UUID docId, String title, DocumentAccessLevel linkAccessLevel) {}

    /**
     * One workspace-audience source. {@code space} is only set for
     * {@link SharingSourceKind#SPACE}, where the visibility check needs the container.
     */
    private record WorkspaceGrant(
            SharingSourceKind kind, UUID id, String title, DocumentAccessLevel level, Space space) {}

    private record WorkspaceGrantView(
            DocumentAccessLevel level,
            boolean blocked,
            boolean inherited,
            SharingSourceKind inheritedFromKind,
            UUID inheritedFromId,
            String inheritedFromTitle) {}
}
