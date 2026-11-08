package com.nextdocs.api.realtime.service;

import com.nextdocs.api.document.repository.DocumentRepository;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Expands an access change into the documents whose open sockets may need re-authorizing.
 *
 * <p>Access is inherited: a grant, a block, a move or a trash on one page changes the
 * effective level of every page beneath it. The walk deliberately includes trashed rows —
 * after a trash, the open sockets are exactly on the rows that just became trashed, and a
 * query filtered on {@code deleted_at IS NULL} would find none of them.
 */
@Service
@RequiredArgsConstructor
public class RealtimeAccessScopeResolver {

    /** Matches the depth cap used by the access resolver. */
    private static final int MAX_TREE_DEPTH = 100;

    private final DocumentRepository documentRepository;

    @Transactional(readOnly = true)
    public List<UUID> forDocument(UUID documentId) {
        return documentRepository.findSubtreeIdsIncludingTrashed(documentId, MAX_TREE_DEPTH + 1);
    }

    /**
     * A space's pages are its roots plus every descendant of each root. The subtree walk
     * numbers the root as depth 1 while the access resolver's chain starts at depth 0 and
     * admits 100 edges, so the walk needs one extra level or the 101st node is never
     * rechecked when the space audience changes.
     */
    @Transactional(readOnly = true)
    public List<UUID> forSpace(UUID spaceId) {
        Set<UUID> ids = new LinkedHashSet<>();
        for (UUID rootId : documentRepository.findIdsBySpace_Id(spaceId)) {
            ids.addAll(documentRepository.findSubtreeIdsIncludingTrashed(rootId, MAX_TREE_DEPTH + 1));
        }
        return List.copyOf(ids);
    }
}
