package com.nextdocs.api.document.repository;

import com.nextdocs.api.document.entity.Document;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

@Repository
public interface DocumentRepository extends JpaRepository<Document, UUID> {

    Page<Document> findAllByUser_IdAndDeletedAtIsNull(UUID userId, Pageable pageable);

    Optional<Document> findByIdAndUser_IdAndDeletedAtIsNull(UUID id, UUID userId);

    Optional<Document> findByIdAndUser_Id(UUID id, UUID userId);

    Optional<Document> findByIdAndDeletedAtIsNull(UUID id);

    @Query(
            value = "SELECT d FROM Document d "
                    + "LEFT JOIN FETCH d.parent "
                    + "JOIN DocumentCollaborator c ON c.document.id = d.id "
                    + "WHERE c.user.id = :userId AND d.deletedAt IS NULL AND c.accessLevel <> com.nextdocs.api.document.entity.DocumentAccessLevel.NO_ACCESS "
                    + "ORDER BY d.updatedAt DESC, d.createdAt DESC, d.id ASC",
            countQuery =
                    "SELECT count(d) FROM Document d "
                            + "JOIN DocumentCollaborator c ON c.document.id = d.id "
                            + "WHERE c.user.id = :userId AND d.deletedAt IS NULL AND c.accessLevel <> com.nextdocs.api.document.entity.DocumentAccessLevel.NO_ACCESS")
    Page<Document> findSharedWithUserId(@Param("userId") UUID userId, Pageable pageable);

    // All direct children of a given parent, non-trashed only; Pageable should sort by siblingOrderKey.
    Page<Document> findAllByParent_IdAndDeletedAtIsNull(UUID parentId, Pageable pageable);

    // All direct children for a collection of parents, including trashed
    List<Document> findAllByParent_IdIn(Collection<UUID> parentIds);

    // Private root documents owned by userId without collaborators with personal navigation order
    @Query("SELECT d, udo.orderKey FROM Document d "
            + "LEFT JOIN UserDocumentOrder udo ON udo.document.id = d.id AND udo.user.id = :userId "
            + "WHERE d.user.id = :userId AND d.parent IS NULL AND d.deletedAt IS NULL "
            + "AND NOT EXISTS (SELECT 1 FROM DocumentCollaborator c WHERE c.document.id = d.id AND c.accessLevel <> com.nextdocs.api.document.entity.DocumentAccessLevel.NO_ACCESS) "
            + "ORDER BY udo.orderKey ASC NULLS LAST, d.createdAt ASC, d.id ASC")
    Page<Object[]> findPrivateRootDocuments(@Param("userId") UUID userId, Pageable pageable);

    // All owned root documents (private + owner-shared) owned by userId with personal navigation order
    @Query("SELECT d, udo.orderKey FROM Document d "
            + "LEFT JOIN UserDocumentOrder udo ON udo.document.id = d.id AND udo.user.id = :userId "
            + "WHERE d.user.id = :userId AND d.parent IS NULL AND d.deletedAt IS NULL "
            + "ORDER BY udo.orderKey ASC NULLS LAST, d.createdAt ASC, d.id ASC")
    Page<Object[]> findAllRootDocuments(@Param("userId") UUID userId, Pageable pageable);

    // Shared root documents (shared with userId OR owned by userId with collaborators)
    @Query("SELECT d, udo.orderKey FROM Document d "
            + "LEFT JOIN UserDocumentOrder udo ON udo.document.id = d.id AND udo.user.id = :userId "
            + "WHERE d.deletedAt IS NULL "
            + "AND (EXISTS (SELECT 1 FROM DocumentCollaborator c WHERE c.document.id = d.id AND c.user.id = :userId AND c.accessLevel <> com.nextdocs.api.document.entity.DocumentAccessLevel.NO_ACCESS) "
            + "     OR (d.user.id = :userId AND d.parent IS NULL AND EXISTS (SELECT 1 FROM DocumentCollaborator c WHERE c.document.id = d.id AND c.accessLevel <> com.nextdocs.api.document.entity.DocumentAccessLevel.NO_ACCESS))) "
            + "ORDER BY udo.orderKey ASC NULLS LAST, d.createdAt ASC, d.id ASC")
    Page<Object[]> findSharedRootDocuments(@Param("userId") UUID userId, Pageable pageable);

    // Sibling max key among direct children under a parent
    @Query("SELECT MAX(d.siblingOrderKey) FROM Document d "
            + "WHERE d.parent.id = :parentId "
            + "AND d.deletedAt IS NULL "
            + "AND d.id <> :excludeId")
    Optional<String> findMaxSiblingOrderKey(@Param("parentId") UUID parentId, @Param("excludeId") UUID excludeId);

    // Sibling min key among direct children under a parent
    @Query("SELECT MIN(d.siblingOrderKey) FROM Document d "
            + "WHERE d.parent.id = :parentId "
            + "AND d.deletedAt IS NULL "
            + "AND d.id <> :excludeId")
    Optional<String> findMinSiblingOrderKey(@Param("parentId") UUID parentId, @Param("excludeId") UUID excludeId);

    // Sibling key for a specific child document
    @Query("SELECT d.siblingOrderKey FROM Document d WHERE d.id = :id AND d.deletedAt IS NULL")
    Optional<String> findSiblingOrderKeyById(@Param("id") UUID id);

    // Fetch all non-trashed siblings under a parent to re-index
    @Query("SELECT d FROM Document d "
            + "WHERE d.parent.id = :parentId "
            + "AND d.deletedAt IS NULL "
            + "ORDER BY d.siblingOrderKey ASC, d.createdAt ASC, d.id ASC")
    List<Document> findAllSiblingsForReindex(@Param("parentId") UUID parentId);

    // Check whether a document has at least one non-trashed child
    @Query("SELECT CASE WHEN COUNT(d) > 0 THEN TRUE ELSE FALSE END "
            + "FROM Document d WHERE d.parent.id = :parentId AND d.deletedAt IS NULL")
    boolean existsNonTrashedChildrenByParentId(@Param("parentId") UUID parentId);

    // Non-trashed child counts per parent, for batch tree listing
    @Query("SELECT d.parent.id AS parentId, COUNT(d) FROM Document d "
            + "WHERE d.parent.id IN :parentIds AND d.deletedAt IS NULL GROUP BY d.parent.id")
    List<Object[]> countNonTrashedChildrenByParentIds(@Param("parentIds") Collection<UUID> parentIds);

    // Effective access level per document, for batch tree listing
    @Query(
            value = "SELECT u.id::uuid AS document_id, resolve_effective_access(:userId, u.id::uuid) AS access_level "
                    + "FROM unnest(string_to_array(:ids, ',')) AS u(id)",
            nativeQuery = true)
    List<Object[]> resolveEffectiveAccessBatch(@Param("userId") UUID userId, @Param("ids") String ids);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("DELETE FROM Document d WHERE d.deletedAt IS NOT NULL AND d.deletedAt < :cutoff")
    int deleteExpiredTrash(@Param("cutoff") OffsetDateTime cutoff);

    @Query(value = "SELECT resolve_effective_access(:userId, :documentId)", nativeQuery = true)
    String resolveEffectiveAccess(@Param("userId") UUID userId, @Param("documentId") UUID documentId);

    @Query(value = "SELECT resolve_public_access(:documentId)", nativeQuery = true)
    String resolvePublicAccess(@Param("documentId") UUID documentId);

    // Public access level per document, for batch public tree listing
    @Query(
            value = "SELECT u.id::uuid AS document_id, resolve_public_access(u.id::uuid) AS access_level "
                    + "FROM unnest(string_to_array(:ids, ',')) AS u(id)",
            nativeQuery = true)
    List<Object[]> resolvePublicAccessBatch(@Param("ids") String ids);

    @Query(
            value = "SELECT * FROM documents d "
                    + "WHERE d.parent_id = :parentId AND d.deleted_at IS NULL "
                    + "AND resolve_public_access(d.id) IS NOT NULL "
                    + "ORDER BY d.sibling_order_key ASC NULLS LAST, d.created_at ASC, d.id ASC",
            countQuery = "SELECT COUNT(*) FROM documents d "
                    + "WHERE d.parent_id = :parentId AND d.deleted_at IS NULL "
                    + "AND resolve_public_access(d.id) IS NOT NULL",
            nativeQuery = true)
    Page<Document> findPublicChildren(@Param("parentId") UUID parentId, Pageable pageable);

    // Public child counts per parent, for batch public tree listing
    @Query(
            value = "SELECT d.parent_id, COUNT(d.id) FROM documents d "
                    + "WHERE d.parent_id IN (:parentIds) AND d.deleted_at IS NULL "
                    + "AND resolve_public_access(d.id) IS NOT NULL "
                    + "GROUP BY d.parent_id",
            nativeQuery = true)
    List<Object[]> countPublicChildrenByParentIds(@Param("parentIds") Collection<UUID> parentIds);

    // Effective access level including trashed documents: resolves against the trash bundle
    // root (topmost contiguous trashed ancestor, or the document itself).
    @Query(value = "SELECT resolve_trash_access(:userId, :documentId)", nativeQuery = true)
    String resolveTrashAccess(@Param("userId") UUID userId, @Param("documentId") UUID documentId);

    @Query(
            value = "SELECT u.id::uuid AS document_id, resolve_trash_access(:userId, u.id::uuid) AS access_level "
                    + "FROM unnest(string_to_array(:ids, ',')) AS u(id)",
            nativeQuery = true)
    List<Object[]> resolveTrashAccessBatch(@Param("userId") UUID userId, @Param("ids") String ids);

    // Trashed documents the user may manage: EDIT-level trash access on the trash bundle root.
    // Documents grafted into another user's trashed subtree follow that subtree's fate and are
    // not listed for creators who cannot manage the bundle.
    @Query("SELECT d FROM Document d "
            + "WHERE d.deletedAt IS NOT NULL "
            + "AND FUNCTION('resolve_trash_access', :userId, d.id) IN ('EDIT', 'OWNER')")
    Page<Document> findAccessibleTrashedDocuments(@Param("userId") UUID userId, Pageable pageable);

    @Query(
            value = "WITH RECURSIVE sub AS ("
                    + "  SELECT id, 1 AS depth FROM documents WHERE id = :subtreeRootId AND deleted_at IS NULL "
                    + "  UNION ALL "
                    + "  SELECT d.id, s.depth + 1 FROM documents d JOIN sub s ON d.parent_id = s.id "
                    + "  WHERE d.deleted_at IS NULL AND s.depth < 100 "
                    + ") SELECT id FROM sub",
            nativeQuery = true)
    List<UUID> findSubtreeDocumentIds(@Param("subtreeRootId") UUID subtreeRootId);

    /**
     * Ancestor ids of a document, closest first, bounded like resolve_effective_access
     * (100 levels). One recursive query replaces a lazy parent select per level when a
     * caller needs the whole chain.
     *
     * A constant rather than an inline literal so the PostgreSQL test runs this exact
     * text: a test that copies the query cannot see the query change.
     */
    String ANCESTOR_CHAIN_SQL = "WITH RECURSIVE chain AS ("
            + "  SELECT p.id, p.parent_id, 1 AS depth FROM documents d "
            + "  JOIN documents p ON d.parent_id = p.id WHERE d.id = :documentId "
            + "  UNION ALL "
            + "  SELECT p.id, p.parent_id, c.depth + 1 FROM documents p "
            + "  JOIN chain c ON p.id = c.parent_id "
            + "  WHERE c.depth < 100 "
            + ") SELECT id FROM chain ORDER BY depth";

    @Query(value = ANCESTOR_CHAIN_SQL, nativeQuery = true)
    List<UUID> findAncestorChainIds(@Param("documentId") UUID documentId);

    /** Batch load for chain/subtree walks: owners are fetched eagerly, parents are not. */
    @Query("SELECT d FROM Document d JOIN FETCH d.user WHERE d.id IN :documentIds")
    List<Document> findAllWithUserByIdIn(@Param("documentIds") Collection<UUID> documentIds);

    /**
     * Parent link per document without loading entities: lets subtree walks answer
     * "has accessible parent" from maps instead of one lazy parent select (plus its
     * owner and access CTE) per document.
     */
    @Query("SELECT d.id, d.parent.id FROM Document d WHERE d.id IN :documentIds")
    List<Object[]> findParentIdsByIdIn(@Param("documentIds") Collection<UUID> documentIds);
}
