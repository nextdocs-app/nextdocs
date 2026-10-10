package com.nextdocs.api.document.repository;

import com.nextdocs.api.document.entity.DocumentCollaborator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface DocumentCollaboratorRepository extends JpaRepository<DocumentCollaborator, UUID> {

    /**
     * Direct collaborators with users fetched eagerly: every caller reads
     * {@code getUser()} per row, so the derived query's lazy load costs one
     * select per collaborator.
     */
    @org.springframework.data.jpa.repository.Query(
            "SELECT c FROM DocumentCollaborator c JOIN FETCH c.user WHERE c.document.id = :documentId")
    List<DocumentCollaborator> findAllByDocument_Id(
            @org.springframework.data.repository.query.Param("documentId") UUID documentId);

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

    @org.springframework.data.jpa.repository.Modifying(flushAutomatically = true)
    @org.springframework.data.jpa.repository.Query(
            "DELETE FROM DocumentCollaborator c WHERE c.document.id IN :documentIds")
    void deleteByDocument_IdIn(
            @org.springframework.data.repository.query.Param("documentIds") java.util.Collection<UUID> documentIds);

    @org.springframework.data.jpa.repository.Query(
            "SELECT DISTINCT c.document.id FROM DocumentCollaborator c "
                    + "WHERE c.document.id IN :documentIds AND c.accessLevel <> com.nextdocs.api.document.entity.DocumentAccessLevel.NO_ACCESS")
    List<UUID> findDocumentIdsWithCollaborators(
            @org.springframework.data.repository.query.Param("documentIds") java.util.Collection<UUID> documentIds);

    /**
     * Whether a strict ancestor grants this user identity access. The V13 function deliberately
     * ignores {@code deleted_at} while {@code DocumentSharingService#loadAncestors} stops at the
     * first trashed ancestor: a NO_ACCESS breakpoint only exists to shadow a grant, so it has to
     * survive the trash of that grant and re-arm when the ancestor is restored, even though the
     * sharing view stops advertising the trashed chain in the meantime. The divergence is
     * intended and pinned by {@code PublicAccessMigrationPostgresTest}.
     */
    @org.springframework.data.jpa.repository.Query(
            value = "SELECT has_positive_ancestor_grant(:userId, :documentId)",
            nativeQuery = true)
    boolean hasPositiveAncestorGrant(
            @org.springframework.data.repository.query.Param("userId") UUID userId,
            @org.springframework.data.repository.query.Param("documentId") UUID documentId);

    /**
     * The document's own collaborators that still hold a positive ancestor grant, in one
     * query rather than one recursive CTE per row. Equivalent to calling
     * {@link #hasPositiveAncestorGrant} for each of the document's collaborator rows, and
     * only meaningful for rows that exist on the document itself.
     */
    String COLLABORATOR_ANCESTOR_GRANT_SQL = "SELECT c.user_id FROM document_collaborators c "
            + "WHERE c.document_id = :documentId "
            + "AND has_positive_ancestor_grant(c.user_id, :documentId)";

    @org.springframework.data.jpa.repository.Query(value = COLLABORATOR_ANCESTOR_GRANT_SQL, nativeQuery = true)
    List<UUID> findCollaboratorUserIdsWithAncestorGrant(
            @org.springframework.data.repository.query.Param("documentId") UUID documentId);

    /**
     * Collaborator rows for several documents in one query, with users fetched eagerly:
     * an ancestor walk otherwise costs one query per level plus a lazy user load per row.
     */
    @org.springframework.data.jpa.repository.Query(
            "SELECT c FROM DocumentCollaborator c JOIN FETCH c.user WHERE c.document.id IN :documentIds")
    List<DocumentCollaborator> findAllByDocument_IdIn(
            @org.springframework.data.repository.query.Param("documentIds") java.util.Collection<UUID> documentIds);

    /**
     * Deletes the NO_ACCESS breakpoints inside a subtree whose user no longer holds a positive
     * ancestor grant, so a later re-grant cannot revive a stale revocation. Kept as a constant so
     * the Postgres test executes this exact statement (DELETE ... USING only exists on Postgres).
     */
    String PRUNE_ORPHANED_BREAKPOINTS_SQL = "WITH RECURSIVE sub AS ("
            + "  SELECT id, 1 AS depth FROM documents WHERE id = :subtreeRootId "
            + "  UNION ALL "
            + "  SELECT d.id, s.depth + 1 FROM documents d JOIN sub s ON d.parent_id = s.id "
            + "  WHERE s.depth < 100 "
            + ") "
            + "DELETE FROM document_collaborators c "
            + "USING sub s "
            + "WHERE c.document_id = s.id "
            + "  AND c.access_level = 'NO_ACCESS' "
            + "  AND NOT has_positive_ancestor_grant(c.user_id, s.id)";

    @org.springframework.data.jpa.repository.Modifying(flushAutomatically = true)
    @org.springframework.data.jpa.repository.Query(value = PRUNE_ORPHANED_BREAKPOINTS_SQL, nativeQuery = true)
    int pruneOrphanedBreakpoints(@org.springframework.data.repository.query.Param("subtreeRootId") UUID subtreeRootId);

    /**
     * Removes one user's NO_ACCESS breakpoints from a subtree, used when their identity leaves it;
     * the rows would otherwise keep shadowing a grant they could inherit again on re-entry.
     */
    String DELETE_NO_ACCESS_IN_SUBTREE_SQL = "WITH RECURSIVE sub AS ("
            + "  SELECT id, 1 AS depth FROM documents WHERE id = :subtreeRootId "
            + "  UNION ALL "
            + "  SELECT d.id, s.depth + 1 FROM documents d JOIN sub s ON d.parent_id = s.id "
            + "  WHERE s.depth < 100 "
            + ") "
            + "DELETE FROM document_collaborators c "
            + "USING sub s "
            + "WHERE c.document_id = s.id "
            + "  AND c.user_id = :userId "
            + "  AND c.access_level = 'NO_ACCESS'";

    @org.springframework.data.jpa.repository.Modifying(flushAutomatically = true)
    @org.springframework.data.jpa.repository.Query(value = DELETE_NO_ACCESS_IN_SUBTREE_SQL, nativeQuery = true)
    int deleteNoAccessInSubtreeForUser(
            @org.springframework.data.repository.query.Param("subtreeRootId") UUID subtreeRootId,
            @org.springframework.data.repository.query.Param("userId") UUID userId);
}
