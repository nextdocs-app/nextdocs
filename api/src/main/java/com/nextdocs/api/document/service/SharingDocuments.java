package com.nextdocs.api.document.service;

import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.repository.DocumentRepository;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Read-only page-chain helpers shared by roster and sharing-settings projections. */
final class SharingDocuments {

    private SharingDocuments() {}

    /**
     * Reachable ancestor chain, closest first, stopping before the first trashed ancestor
     * (mirrors resolve_effective_access, whose grants never resolve above a trash bundle) or
     * a concurrently deleted one. One recursive id query plus one batch load, instead of a
     * lazy parent select per level.
     *
     * <p>Stopping at trash is deliberate and differs from
     * {@link com.nextdocs.api.document.repository.AccessGrantRepository#hasPositiveIdentityGrant},
     * which walks through trash so a NO_ACCESS breakpoint survives a trashed grant and
     * re-arms when the ancestor is restored. What is displayed here is the chain a reader
     * can browse, so a trashed ancestor is not part of it even when its grants still govern
     * the breakpoint table.
     */
    static List<Document> loadReachableAncestors(DocumentRepository documentRepository, Document doc) {
        // Traversal bound: the query stops at the same 100 levels the resolution
        // functions use, so a cycle or a pathologically deep tree cannot run away.
        List<UUID> ancestorIds = documentRepository.findAncestorChainIds(doc.getId());
        if (ancestorIds.isEmpty()) {
            return List.of();
        }

        Map<UUID, Document> byId = new HashMap<>();
        for (Document ancestor : documentRepository.findAllWithUserByIdIn(ancestorIds)) {
            byId.put(ancestor.getId(), ancestor);
        }

        List<Document> reachable = new ArrayList<>();
        for (UUID ancestorId : ancestorIds) {
            Document ancestor = byId.get(ancestorId);
            if (ancestor == null || ancestor.getDeletedAt() != null) {
                break;
            }
            reachable.add(ancestor);
        }
        return reachable;
    }

    static String titleOrUntitled(Document doc) {
        return doc.getTitle() != null && !doc.getTitle().isBlank() ? doc.getTitle() : "Untitled";
    }
}
