package com.nextdocs.api.document.service;

import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.entity.AccessGrant;
import com.nextdocs.api.document.entity.AccessGrantEffect;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.repository.AccessGrantRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.space.entity.Space;
import com.nextdocs.api.space.repository.SpaceMemberRepository;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Ownership policy for standalone pages: inherited owners that may not be blocked, and
 * whether a change would leave the page without an owner. Ownership is an ordinary grant
 * row, so this is read-only policy; {@link DocumentSharingService} keeps the write
 * orchestration (grants, ordering, audit, events) so the two concerns do not depend on
 * each other.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class DocumentOwnershipService {

    private final DocumentRepository documentRepository;
    private final AccessGrantRepository accessGrantRepository;
    private final PermissionService permissionService;
    private final SpaceMemberRepository spaceMemberRepository;

    /**
     * Guards a standalone page against losing its last owner. The caller has already
     * established that {@code userId} owns this page and that the change lowers or removes
     * that ownership. An ancestor owner is not "the last owner here": they still administer
     * sharing from above and can restore access below.
     */
    public void requireAnotherOwner(Document doc, UUID userId, String message) {
        if (!permissionService.ownsAncestor(userId, doc) && !hasOtherOwner(doc, userId)) {
            throw new ApiException(ErrorCode.CONFLICT, message);
        }
    }

    /**
     * The refusal for blocking someone whose OWNER access is inherited, or null when a
     * page-level No access row is allowed. Ownership belongs to the scope it comes from: a
     * space owner (or the workspace owner of that space), or an owner of an ancestor page,
     * keeps access to that scope's descendants. A private page sits outside the
     * workspace/space hierarchy, so the workspace owner role alone does not block a
     * page-level No access row there. Only the owners of that scope may change their
     * standing.
     */
    public String inheritedOwnerBlockMessage(Document doc, UUID targetUserId) {
        Space space = permissionService.resolveSpace(doc);
        // A private page is not part of the workspace/space hierarchy, so the workspace
        // owner role is not an inherited owner on it. Space pages are different: the
        // workspace owns every space, so its owner stays unblockable there.
        if (space != null && permissionService.isWorkspaceOwner(targetUserId, doc)) {
            return "A workspace owner cannot be set to No access on this page.";
        }

        if (space != null
                && spaceMemberRepository
                        .findBySpace_IdAndUser_Id(space.getId(), targetUserId)
                        .map(member -> member.getAccessLevel() == DocumentAccessLevel.OWNER)
                        .orElse(false)) {
            return "An inherited owner cannot be set to No access on this page.";
        }

        // A root has no ancestor to own, so skip the chain lookup.
        if (doc.getParent() == null) {
            return null;
        }
        // Ancestor ownership is a subtree grant: a lower override on the way down (an
        // intervening EDIT row, or a No access breakpoint) can demote what the owner sees
        // but cannot take away their right to administer below the page they own. This is
        // the same rule requireSharingAdminAccess uses.
        if (permissionService.ownsAncestor(targetUserId, doc)) {
            return "An inherited owner cannot be set to No access on this page.";
        }
        return null;
    }

    /**
     * Hierarchical picture for one document, loaded in a fixed number of queries whatever
     * the tree depth: the reachable ancestor chain and each ancestor's user grant rows.
     */
    public AncestorContext loadAncestorContext(Document doc) {
        List<Document> ancestors = SharingDocuments.loadReachableAncestors(documentRepository, doc);
        if (ancestors.isEmpty()) {
            return new AncestorContext(List.of(), Map.of());
        }

        Map<UUID, List<AccessGrant>> rowsByDocument = new HashMap<>();
        for (AccessGrant row : accessGrantRepository.findUserGrantsByDocumentIdIn(
                ancestors.stream().map(Document::getId).toList())) {
            rowsByDocument
                    .computeIfAbsent(row.getDocument().getId(), key -> new ArrayList<>())
                    .add(row);
        }
        return new AncestorContext(ancestors, rowsByDocument);
    }

    /**
     * True when someone other than {@code excludedUserId} still resolves OWNER on a
     * standalone page. Candidates are the positive OWNER rows on this page plus the OWNER
     * rows on its ancestors. Each candidate is checked through the resolver, so a block or
     * a lower page override on the way down still counts as "not an owner here".
     *
     * <p>Only user rows are candidates: no write path grants a page to a workspace group
     * yet, so a group OWNER cannot be another owner here. Revisit this when page grants can
     * target a group.
     */
    private boolean hasOtherOwner(Document doc, UUID excludedUserId) {
        Set<UUID> candidates = new HashSet<>();

        for (AccessGrant grant : accessGrantRepository.findPositiveUserGrantsByDocumentId(doc.getId())) {
            if (grant.getAccessLevel() == DocumentAccessLevel.OWNER) {
                candidates.add(grant.getUser().getId());
            }
        }

        AncestorContext ancestors = loadAncestorContext(doc);
        for (Document ancestor : ancestors.ancestors()) {
            List<AccessGrant> rows = ancestors.grantsByDocument().getOrDefault(ancestor.getId(), List.of());
            for (AccessGrant row : rows) {
                if (row.getEffect() == AccessGrantEffect.ALLOW && row.getAccessLevel() == DocumentAccessLevel.OWNER) {
                    candidates.add(row.getUser().getId());
                }
            }
        }

        candidates.remove(excludedUserId);
        if (candidates.isEmpty()) {
            return false;
        }
        Map<UUID, DocumentAccessLevel> levels =
                permissionService.resolveAccessForUsers(doc.getId(), candidates, doc.getDeletedAt() != null);
        return levels.values().stream().anyMatch(level -> level == DocumentAccessLevel.OWNER);
    }

    public record AncestorContext(List<Document> ancestors, Map<UUID, List<AccessGrant>> grantsByDocument) {}
}
