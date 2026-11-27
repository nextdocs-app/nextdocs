package com.nextdocs.api.document.service;

import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.dto.response.AccessExplainResponse;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.repository.AccessGrantRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.space.entity.Space;
import com.nextdocs.api.space.service.SpaceAccessService;
import com.nextdocs.api.space.service.SpaceAccessService.SpaceContext;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import com.nextdocs.api.workspace.service.WorkspaceAccessService;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Authoritative service to resolve effective permissions and enforce access control.
 * It replaces direct ownership/collaborator lookups with ancestor-walk resolution.
 *
 * <p>The SQL resolver is the identity contract: nearest-page overrides, page No access
 * barriers, and identity-only trash resolution. Public links are a separate positive
 * channel, and so is the workspace audience (a page's own setting, or a space's, which a
 * page in it can override or block). The golden matrix pins the SQL contract.
 */
@Service
@RequiredArgsConstructor
public class PermissionService {

    // The native batch queries turn the id set into one string_to_array expression.
    // Keeping a request under this bound avoids a multi-megabyte parameter and lets the
    // planner use an index lookup per chunk instead of one giant unnest.
    private static final int MAX_BATCH_SIZE = 1000;

    /**
     * A document plus the comment-capable level that granted access to it. Comment
     * callers need the level for per-thread/per-comment abilities, so resolving it
     * twice (once to gate, once to answer) would only add a second recursive CTE.
     */
    public record DocumentCommentAccess(Document document, DocumentAccessLevel accessLevel) {

        public boolean canEdit() {
            return accessLevel.allowsEdit();
        }
    }

    private final DocumentRepository documentRepository;
    private final AccessGrantRepository accessGrantRepository;
    private final SpaceAccessService spaceAccessService;
    private final WorkspaceAccessService workspaceAccessService;
    private final WorkspaceMemberRepository workspaceMemberRepository;

    /**
     * Resolves the effective access level of a user for a document.
     * Resolves identity overrides along the ancestor chain, then takes the higher
     * of that identity level and the independent public-link level.
     *
     * @return the resolved access level, or null if no access is granted
     */
    @Transactional(readOnly = true)
    public DocumentAccessLevel resolveAccess(UUID userId, UUID documentId) {
        String raw = documentRepository.resolveEffectiveAccess(userId, documentId);
        if (raw == null) {
            return null;
        }
        DocumentAccessLevel level = DocumentAccessLevel.valueOf(raw);
        return level.allowsRead() ? level : null;
    }

    /**
     * Resolves the effective anonymous (share-link) access level of a document.
     * Walks up the ancestor chain (closest-ancestor-wins); per-document
     * ANYONE_WITH_LINK contributes its link_access_level, RESTRICTED inherits
     * through. Returns null when no ancestor grants public access.
     */
    @Transactional(readOnly = true)
    public DocumentAccessLevel resolvePublicAccess(UUID documentId) {
        String raw = documentRepository.resolvePublicAccess(documentId);
        if (raw == null) {
            return null;
        }
        DocumentAccessLevel level = DocumentAccessLevel.valueOf(raw);
        return level.allowsRead() ? level : null;
    }

    /**
     * Raw versus effective access, without re-implementing precedence in Java. The two
     * channels are resolved by the same SQL functions the gates use; this method only
     * compares their positive levels and names the winner.
     */
    @Transactional(readOnly = true)
    public AccessExplainResponse explainAccess(UUID userId, UUID documentId) {
        Document document =
                documentRepository.findById(documentId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
        boolean trashed = document.getDeletedAt() != null;
        String identity = documentRepository.resolveIdentityAccess(userId, documentId, trashed ? "TRASH" : "ACTIVE");
        String link = trashed ? null : documentRepository.resolvePublicAccess(documentId);
        int identityRank = accessRank(identity);
        int linkRank = accessRank(link);
        String effective = linkRank > identityRank ? link : identity;
        String effectiveLevel = effective != null ? effective : "NO_ACCESS";
        String channel = linkRank > identityRank ? "LINK" : effective != null ? "IDENTITY" : null;
        return new AccessExplainResponse(
                documentId,
                effectiveLevel,
                identity,
                link,
                channel,
                "NO_ACCESS".equals(effectiveLevel),
                "NO_ACCESS".equals(identity));
    }

    private static int accessRank(String level) {
        return level == null ? 0 : DocumentAccessLevel.valueOf(level).rank();
    }

    /**
     * Resolves the effective access level of a user for a batch of documents.
     * One native query replaces one recursive CTE per document for callers that
     * already hold the id set (ancestor walks, subtree reconciles).
     */
    @Transactional(readOnly = true)
    public Map<UUID, DocumentAccessLevel> resolveAccessBatch(UUID userId, Collection<UUID> documentIds) {
        return resolveBatch(documentIds, ids -> documentRepository.resolveEffectiveAccessBatch(userId, joinIds(ids)));
    }

    /**
     * Resolves the identity channel for a batch of active documents, without public-link
     * access. Shared-root reconciliation uses this to keep link-only readers out of the
     * signed-in Shared section.
     */
    @Transactional(readOnly = true)
    public Map<UUID, DocumentAccessLevel> resolveIdentityAccessBatch(UUID userId, Collection<UUID> documentIds) {
        return resolveBatch(documentIds, ids -> documentRepository.resolveIdentityAccessBatch(userId, joinIds(ids)));
    }

    /**
     * Resolves the effective anonymous access level for a batch of documents.
     */
    @Transactional(readOnly = true)
    public Map<UUID, DocumentAccessLevel> resolvePublicAccessBatch(Collection<UUID> documentIds) {
        return resolveBatch(documentIds, ids -> documentRepository.resolvePublicAccessBatch(joinIds(ids)));
    }

    /**
     * Resolves one document's identity level for several users at once. The
     * collaborator roster needs this: each row reports what that person can
     * actually do via identity channels here, so a page owner demoted by their space membership no
     * longer displays as an owner. Keys are present even when the level is
     * null, so a caller can tell "blocked" from "not queried".
     */
    @Transactional(readOnly = true)
    public Map<UUID, DocumentAccessLevel> resolveAccessForUsers(
            UUID documentId, Collection<UUID> userIds, boolean trashed) {
        String joined = joinIds(userIds);
        if (joined == null) {
            return Map.of();
        }
        List<Object[]> rows = trashed
                ? documentRepository.resolveTrashAccessForUsers(documentId, joined)
                : documentRepository.resolveIdentityAccessForUsers(documentId, joined);
        Map<UUID, DocumentAccessLevel> result = new HashMap<>();
        for (Object[] row : rows) {
            if (row[0] == null) {
                continue;
            }
            UUID userId = toUuid(row[0]);
            DocumentAccessLevel level = row[1] == null ? null : DocumentAccessLevel.valueOf(row[1].toString());
            result.put(userId, level != null && level.allowsRead() ? level : null);
        }
        return result;
    }

    /**
     * Resolves trash-scope access for a batch of documents.
     */
    @Transactional(readOnly = true)
    public Map<UUID, DocumentAccessLevel> resolveTrashAccessBatch(UUID userId, Collection<UUID> documentIds) {
        return resolveBatch(documentIds, ids -> documentRepository.resolveTrashAccessBatch(userId, joinIds(ids)));
    }

    /**
     * Shared batch loop: one bad entry must not deny the whole batch, the
     * allowsRead gate must stay in one place so a future edit cannot drop it
     * on a single path and leak NO_ACCESS/BLOCKED as a level, and a large id
     * set must be split before it becomes one huge query parameter.
     */
    private Map<UUID, DocumentAccessLevel> resolveBatch(
            Collection<UUID> documentIds, Function<List<UUID>, List<Object[]>> query) {
        if (documentIds == null || documentIds.isEmpty()) {
            return Map.of();
        }
        // A single null element would NPE the join or abort the whole batch cast.
        // Skip nulls so one bad caller entry cannot deny every document.
        List<UUID> ids =
                documentIds.stream().filter(Objects::nonNull).distinct().toList();
        if (ids.isEmpty()) {
            return Map.of();
        }

        Map<UUID, DocumentAccessLevel> result = new HashMap<>();
        for (int start = 0; start < ids.size(); start += MAX_BATCH_SIZE) {
            List<UUID> chunk = ids.subList(start, Math.min(start + MAX_BATCH_SIZE, ids.size()));
            for (Object[] row : query.apply(chunk)) {
                if (row[0] != null && row[1] != null) {
                    UUID docId = toUuid(row[0]);
                    DocumentAccessLevel level = DocumentAccessLevel.valueOf(row[1].toString());
                    if (level.allowsRead()) {
                        result.put(docId, level);
                    }
                }
            }
        }
        return result;
    }

    private static String joinIds(Collection<UUID> documentIds) {
        String joined = documentIds.stream()
                .filter(Objects::nonNull)
                .map(UUID::toString)
                .collect(Collectors.joining(","));
        return joined.isEmpty() ? null : joined;
    }

    private static UUID toUuid(Object raw) {
        return raw instanceof UUID u ? u : UUID.fromString(raw.toString());
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
     * Enforces that the user holds COMMENT or higher on a live document. A caller
     * without read access is masked as not-found (existence privacy); a reader below
     * COMMENT (VIEW) is refused outright so comment payloads never reach them.
     *
     * @return the Document and the level that granted comment access
     */
    @Transactional(readOnly = true)
    public DocumentCommentAccess requireCommentAccess(UUID userId, UUID documentId) {
        Document doc = documentRepository
                .findByIdAndDeletedAtIsNull(documentId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));

        DocumentAccessLevel access = resolveAccess(userId, documentId);
        if (access == null) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
        if (!access.allowsComment()) {
            throw new ApiException(ErrorCode.FORBIDDEN);
        }
        return new DocumentCommentAccess(doc, access);
    }

    /**
     * Anonymous counterpart of {@link #requireCommentAccess}: the share-link level
     * must reach COMMENT. Used by comments so a COMMENT link can discuss a page
     * without granting any Yjs write access to the document body.
     */
    @Transactional(readOnly = true)
    public DocumentCommentAccess requirePublicCommentAccess(UUID documentId) {
        Document doc = documentRepository
                .findByIdAndDeletedAtIsNull(documentId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));

        DocumentAccessLevel access = resolvePublicAccess(documentId);
        if (access == null) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
        if (!access.allowsComment()) {
            throw new ApiException(ErrorCode.FORBIDDEN);
        }
        return new DocumentCommentAccess(doc, access);
    }

    /**
     * Roster visibility requires a workspace identity: an owner/user/group grant, a space
     * baseline, a workspace audience, or membership in the document's workspace. A
     * link-only outsider can open the document but must not enumerate member names or
     * emails. Masked as not found so link holders cannot distinguish a private document
     * from a hidden roster.
     *
     * <p>Shared by every surface that renders the member roster: the collaborator list
     * and the mention picker both disclose people, so both use this one rule.
     */
    @Transactional(readOnly = true)
    public void requireRosterAccess(UUID requesterId, Document doc) {
        // The grant store is the authority, not creator attribution: a direct OWNER row
        // authorizes the creator, and a creator whose grant was revoked (or who is only
        // admitted by a link) does not enumerate the roster.
        if (accessGrantRepository.hasPositiveIdentityGrant(requesterId, doc.getId())) {
            return;
        }
        if (hasSpaceGrant(requesterId, doc)) {
            return;
        }
        // A workspace member keeps their workspace identity even when the only channel
        // that opened this page is a public link. The roster is withheld only from a
        // link-only reader outside the workspace, who has no identity here at all.
        Workspace workspace = doc.getWorkspace();
        if (workspace != null
                && workspaceMemberRepository.existsByWorkspaceIdAndUserId(workspace.getId(), requesterId)) {
            return;
        }
        throw new ApiException(ErrorCode.NOT_FOUND);
    }

    /**
     * A space grant is an identity grant: a space member already sees the space roster, so
     * hiding a page's roster from them would be theatre. Space administrators count too,
     * even without a content level, because sharing is their call. In a public space, workspace
     * members pass here to inspect direct document collaborators. Anonymous or external
     * link-only readers outside the workspace have no workspace identity and are refused.
     */
    private boolean hasSpaceGrant(UUID userId, Document doc) {
        Space space = resolveSpace(doc);
        if (space == null) {
            return false;
        }
        try {
            SpaceContext context = spaceAccessService.load(userId, space.getId());
            return context != null && (context.accessLevel() != null || context.canAdminister());
        } catch (ApiException ex) {
            if (ex.getErrorCode() == ErrorCode.NOT_FOUND) {
                return false;
            }
            throw ex;
        }
    }

    /**
     * Enforces that the user may administer sharing for the document. A page inside
     * a space follows the same closest-ancestor rule as content: an effective page
     * OWNER (usually an explicit collaborator row) is the authority, and space
     * administration remains the fallback so a space OWNER or workspace admin can
     * still manage every page. A private page keeps the workspace id but lives in
     * its creator's personal section, outside that hierarchy: only an effective page
     * OWNER or an owner of one of its ancestors may administer sharing there. The
     * existence mask for callers with no access and the archived-space 409 stay
     * unchanged.
     *
     * @return the Document when the caller may administer sharing
     */
    @Transactional(readOnly = true)
    public Document requireSharingAdminAccess(UUID userId, UUID documentId) {
        Document active =
                documentRepository.findByIdAndDeletedAtIsNull(documentId).orElse(null);
        Document doc = active != null
                ? active
                : documentRepository.findById(documentId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));

        Space space = resolveSpace(doc);
        if (space != null) {
            if (space.getArchivedAt() != null) {
                // The archive freezes sharing even for a page OWNER. Route through
                // administration so the caller gets the same 409/403/404 as before.
                spaceAccessService.requireActiveAdministration(userId, space.getId());
                return doc;
            }

            // A page-level OWNER overrides a lower space grant, so it must also
            // carry the sharing rights that make OWNER truthful.
            DocumentAccessLevel pageAccess =
                    active != null ? resolveAccess(userId, documentId) : resolveTrashAccess(userId, documentId);
            if (pageAccess == DocumentAccessLevel.OWNER) {
                return doc;
            }

            // Ownership of an ancestor page is a subtree grant, so it survives a
            // child-level demotion on the way down.
            if (ownsAncestor(userId, doc)) {
                return doc;
            }

            // Space administration remains the fallback: the caller may be a
            // workspace admin without a content grant, which is why this does not
            // require a page grant before checking space ownership.
            spaceAccessService.requireActiveAdministration(userId, space.getId());
            return doc;
        }

        DocumentAccessLevel access =
                active != null ? resolveAccess(userId, documentId) : resolveTrashAccess(userId, documentId);
        // Ownership of an ancestor is a subtree grant, so it survives a child-level
        // demotion on the way down. Evaluate it before rejecting missing page access: an
        // ancestor owner blocked by a No access row below still administers that subtree.
        boolean ancestorOwner = ownsAncestor(userId, doc);
        if (access == null && !ancestorOwner) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
        // A private page keeps the workspace id but lives in its creator's personal
        // section, outside the workspace/space hierarchy. A workspace role is not a
        // grant on it: only the page owner or an owner of one of its ancestors may
        // administer sharing. Owning an ancestor is a subtree grant.
        if (access != DocumentAccessLevel.OWNER && !ancestorOwner) {
            throw new ApiException(ErrorCode.FORBIDDEN);
        }
        return doc;
    }

    /**
     * True only for the workspace OWNER role. Admins administer, but ownership of
     * the workspace itself is what keeps a person unblockable below it.
     */
    @Transactional(readOnly = true)
    public boolean isWorkspaceOwner(UUID userId, Document doc) {
        return workspaceRole(userId, doc)
                .map(role -> role == WorkspaceRole.OWNER)
                .orElse(false);
    }

    /**
     * True when the caller is an effective OWNER of a strict ancestor. Ownership is a
     * subtree grant: a nearer page can lower what the caller sees, but it cannot take
     * away their right to administer sharing (and restore their own level) anywhere
     * below the level they own. Workspace and space ownership are separate gates.
     */
    @Transactional(readOnly = true)
    public boolean ownsAncestor(UUID userId, Document doc) {
        List<UUID> ancestorIds = documentRepository.findAncestorChainIds(doc.getId());
        if (ancestorIds.isEmpty()) {
            return false;
        }
        Map<UUID, DocumentAccessLevel> levels = doc.getDeletedAt() != null
                ? resolveTrashAccessBatch(userId, ancestorIds)
                : resolveAccessBatch(userId, ancestorIds);
        return levels.containsValue(DocumentAccessLevel.OWNER);
    }

    private Optional<WorkspaceRole> workspaceRole(UUID userId, Document doc) {
        if (doc.getWorkspace() == null) {
            return Optional.empty();
        }
        return workspaceAccessService
                .findMember(userId)
                .filter(membership ->
                        membership.workspace().getId().equals(doc.getWorkspace().getId()))
                .map(membership -> membership.member().getRole());
    }

    /**
     * Read access for documents including those in trash. Active documents resolve
     * through the standard ancestor access chain; trashed documents resolve through
     * the trash access chain. Any valid access level allows reading collaborators.
     *
     * @return the Document if accessible
     */
    @Transactional(readOnly = true)
    public Document requireReadAccessIncludingTrash(UUID userId, UUID documentId) {
        Document active =
                documentRepository.findByIdAndDeletedAtIsNull(documentId).orElse(null);
        if (active != null) {
            DocumentAccessLevel access = resolveAccess(userId, documentId);
            if (access == null) {
                throw new ApiException(ErrorCode.NOT_FOUND);
            }
            return active;
        }
        Document trashed =
                documentRepository.findById(documentId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND));
        DocumentAccessLevel access = resolveTrashAccess(userId, documentId);
        if (access == null) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
        return trashed;
    }

    /**
     * Rejects a page anchored in an archived space with 409. The archive caps every
     * level, ownership included, at VIEW, so gates that resolve only the trash scope
     * see null and would otherwise mask an existing page as deleted.
     */
    public void requireActiveSpace(Document doc) {
        Space space = resolveSpace(doc);
        if (space != null && space.getArchivedAt() != null) {
            throw new ApiException(
                    ErrorCode.CONFLICT, "This page is in an archived space. Restore the space to manage sharing.");
        }
    }

    /**
     * The space anchoring this document's tree, or null for a standalone page.
     * Only a root page carries {@code space_id}, so a child has to walk up; the
     * bound mirrors the permission functions' 100-level recursion cap.
     */
    public Space resolveSpace(Document doc) {
        Document current = doc;
        int depth = 0;
        while (current != null && depth < 100) {
            if (current.getSpace() != null) {
                return current.getSpace();
            }
            current = current.getParent();
            depth++;
        }
        return null;
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
        DocumentAccessLevel level = DocumentAccessLevel.valueOf(raw);
        return level.allowsRead() ? level : null;
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
