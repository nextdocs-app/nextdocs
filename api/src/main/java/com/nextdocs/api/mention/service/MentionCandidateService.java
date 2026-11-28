package com.nextdocs.api.mention.service;

import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.service.PermissionService;
import com.nextdocs.api.mention.dto.response.MentionCandidateResponse;
import com.nextdocs.api.user.entity.User;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import com.nextdocs.api.workspace.service.WorkspaceAccessService;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Resolves who the `@` picker may offer for one document.
 *
 * <p>The candidate set is workspace members narrowed twice: by the typed query in the
 * database, then by the same effective-access resolver the comment and realtime gates
 * use. That second step is what keeps the picker honest for space caps, NO_ACCESS
 * breakpoints, archived spaces, and pages that are not shared with the whole workspace.
 */
@Service
@RequiredArgsConstructor
public class MentionCandidateService {

    private static final int MAX_LIMIT = 50;

    /** Page size over-fetches because the access filter can drop rows the query matched. */
    private static final int SEARCH_MULTIPLIER = 4;

    private static final int MAX_QUERY_LENGTH = 100;

    private final WorkspaceMemberRepository memberRepository;
    private final WorkspaceAccessService workspaceAccessService;
    private final PermissionService permissionService;

    @Transactional(readOnly = true)
    public List<MentionCandidateResponse> search(UUID callerId, UUID documentId, String query, int limit) {
        // COMMENT is enough: an editor can mention in the body, a commenter in a reply.
        // VIEW-only readers never see the picker.
        PermissionService.DocumentCommentAccess access = permissionService.requireCommentAccess(callerId, documentId);
        // COMMENT can also be granted by a share link. A workspace member may mention even
        // when the link is the only channel that opened the page; a link-only outsider
        // must not enumerate the workspace roster, so the picker uses the same rule as the
        // collaborator list.
        permissionService.requireRosterAccess(callerId, access.document());
        WorkspaceAccessService.Membership membership = workspaceAccessService.requireMember(callerId);

        int cappedLimit = Math.min(Math.max(limit, 1), MAX_LIMIT);
        String normalizedQuery = normalizeQuery(query);
        int pageSize = cappedLimit * SEARCH_MULTIPLIER;

        // The database page can be mostly people without access, so keep paging until the
        // answer is full or the matches run out. A fixed page budget would answer
        // "nobody" for a document whose first matches all lack access while later ones
        // qualify; the short page is what proves the query is exhausted.
        List<MentionCandidateResponse> candidates = new ArrayList<>(cappedLimit);
        for (int page = 0; candidates.size() < cappedLimit; page++) {
            List<User> matches = memberRepository.searchMentionableUsers(
                    membership.workspace().getId(), normalizedQuery, PageRequest.of(page, pageSize));
            collectEligible(documentId, callerId, matches, candidates, cappedLimit);
            if (matches.size() < pageSize) {
                break;
            }
        }
        return candidates;
    }

    /** Appends the page's candidates that the caller may actually mention, in page order. */
    private void collectEligible(
            UUID documentId,
            UUID callerId,
            List<User> matches,
            List<MentionCandidateResponse> candidates,
            int cappedLimit) {
        List<User> others =
                matches.stream().filter(user -> !user.getId().equals(callerId)).toList();
        if (others.isEmpty()) {
            return;
        }

        Set<UUID> userIds = new LinkedHashSet<>();
        for (User user : others) {
            userIds.add(user.getId());
        }
        Map<UUID, DocumentAccessLevel> access = permissionService.resolveAccessForUsers(documentId, userIds, false);

        for (User user : others) {
            if (candidates.size() >= cappedLimit) {
                return;
            }
            if (access.get(user.getId()) == null) {
                continue;
            }
            candidates.add(new MentionCandidateResponse(
                    user.getId(), user.getEmail(), user.getDisplayName(), user.getAvatarUrl()));
        }
    }

    private static String normalizeQuery(String query) {
        if (query == null) {
            return "";
        }
        String stripped = query.strip();
        return stripped.length() <= MAX_QUERY_LENGTH ? stripped : stripped.substring(0, MAX_QUERY_LENGTH);
    }
}
