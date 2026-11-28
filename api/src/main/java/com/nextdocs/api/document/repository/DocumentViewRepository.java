package com.nextdocs.api.document.repository;

import com.nextdocs.api.document.entity.DocumentView;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DocumentViewRepository extends JpaRepository<DocumentView, UUID> {

    Optional<DocumentView> findByDocumentIdAndUserId(UUID documentId, UUID userId);

    /**
     * The recent head of the document's view history, newest first.
     *
     * <p>Bounded on purpose: the toolbar renders a handful of faces plus a "+N" chip, so
     * a page in a 5,000-person workspace must not answer 5,000 rows on every open and
     * every poll. The id tie-break keeps two visits in the same instant from swapping
     * places between reads.
     */
    List<DocumentView> findTop50ByDocumentIdOrderByLastViewedAtDescIdAsc(UUID documentId);
}
