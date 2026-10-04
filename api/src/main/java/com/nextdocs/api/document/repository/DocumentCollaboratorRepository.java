package com.nextdocs.api.document.repository;

import com.nextdocs.api.document.entity.DocumentCollaborator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface DocumentCollaboratorRepository extends JpaRepository<DocumentCollaborator, UUID> {

    List<DocumentCollaborator> findAllByDocument_Id(UUID documentId);

    Optional<DocumentCollaborator> findByDocument_IdAndUser_Id(UUID documentId, UUID userId);

    boolean existsByDocument_IdAndUser_Id(UUID documentId, UUID userId);

    // NO_ACCESS rows are breakpoints, not collaborators, so they do not make a document
    // "shared" on their own: such a row only exists inside an inherited-shared tree, whose
    // root carries the shared affordance.
    @org.springframework.data.jpa.repository.Query(
            "SELECT CASE WHEN COUNT(c) > 0 THEN TRUE ELSE FALSE END FROM DocumentCollaborator c "
                    + "WHERE c.document.id = :documentId AND c.accessLevel <> com.nextdocs.api.document.entity.DocumentAccessLevel.NO_ACCESS")
    boolean existsByDocument_Id(@org.springframework.data.repository.query.Param("documentId") UUID documentId);

    void deleteByDocument_IdAndUser_Id(UUID documentId, UUID userId);

    @org.springframework.data.jpa.repository.Modifying(clearAutomatically = true, flushAutomatically = true)
    @org.springframework.data.jpa.repository.Query(
            "DELETE FROM DocumentCollaborator c WHERE c.document.id = :documentId")
    void deleteByDocument_Id(@org.springframework.data.repository.query.Param("documentId") UUID documentId);

    @org.springframework.data.jpa.repository.Query(
            "SELECT DISTINCT c.document.id FROM DocumentCollaborator c "
                    + "WHERE c.document.id IN :documentIds AND c.accessLevel <> com.nextdocs.api.document.entity.DocumentAccessLevel.NO_ACCESS")
    List<UUID> findDocumentIdsWithCollaborators(
            @org.springframework.data.repository.query.Param("documentIds") java.util.Collection<UUID> documentIds);

    @org.springframework.data.jpa.repository.Query(
            value = "SELECT has_positive_ancestor_grant(:userId, :documentId)",
            nativeQuery = true)
    boolean hasPositiveAncestorGrant(
            @org.springframework.data.repository.query.Param("userId") UUID userId,
            @org.springframework.data.repository.query.Param("documentId") UUID documentId);

    @org.springframework.data.jpa.repository.Modifying(flushAutomatically = true)
    @org.springframework.data.jpa.repository.Query(
            value = "WITH RECURSIVE sub AS ("
                    + "  SELECT id, 1 AS depth FROM documents WHERE id = :subtreeRootId "
                    + "  UNION ALL "
                    + "  SELECT d.id, s.depth + 1 FROM documents d JOIN sub s ON d.parent_id = s.id "
                    + "  WHERE s.depth < 100 "
                    + ") "
                    + "DELETE FROM document_collaborators c "
                    + "USING sub s "
                    + "WHERE c.document_id = s.id "
                    + "  AND c.access_level = 'NO_ACCESS' "
                    + "  AND NOT has_positive_ancestor_grant(c.user_id, s.id)",
            nativeQuery = true)
    int pruneOrphanedBreakpoints(@org.springframework.data.repository.query.Param("subtreeRootId") UUID subtreeRootId);

    @org.springframework.data.jpa.repository.Modifying(flushAutomatically = true)
    @org.springframework.data.jpa.repository.Query(
            value = "WITH RECURSIVE sub AS ("
                    + "  SELECT id, 1 AS depth FROM documents WHERE id = :subtreeRootId "
                    + "  UNION ALL "
                    + "  SELECT d.id, s.depth + 1 FROM documents d JOIN sub s ON d.parent_id = s.id "
                    + "  WHERE s.depth < 100 "
                    + ") "
                    + "DELETE FROM document_collaborators c "
                    + "USING sub s "
                    + "WHERE c.document_id = s.id "
                    + "  AND c.user_id = :userId "
                    + "  AND c.access_level = 'NO_ACCESS'",
            nativeQuery = true)
    int deleteNoAccessInSubtreeForUser(
            @org.springframework.data.repository.query.Param("subtreeRootId") UUID subtreeRootId,
            @org.springframework.data.repository.query.Param("userId") UUID userId);
}
