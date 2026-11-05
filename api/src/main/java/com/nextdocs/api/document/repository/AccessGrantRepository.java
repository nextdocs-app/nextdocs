package com.nextdocs.api.document.repository;

import com.nextdocs.api.document.entity.AccessGrant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

@Repository
public interface AccessGrantRepository extends JpaRepository<AccessGrant, UUID> {

    Optional<AccessGrant> findByDocument_IdAndUser_Id(UUID documentId, UUID userId);

    boolean existsByDocument_IdAndUser_Id(UUID documentId, UUID userId);

    /** Direct user rows for the collaborator roster; group/audience rows are not people. */
    @Query("SELECT g FROM AccessGrant g JOIN FETCH g.user JOIN FETCH g.document "
            + "WHERE g.document.id = :documentId AND g.user IS NOT NULL "
            + "ORDER BY g.createdAt ASC, g.id ASC")
    List<AccessGrant> findUserGrantsByDocumentId(@Param("documentId") UUID documentId);

    /** One batched fetch for the ancestor roster instead of a query per level. */
    @Query("SELECT g FROM AccessGrant g JOIN FETCH g.user JOIN FETCH g.document "
            + "WHERE g.document.id IN :documentIds AND g.user IS NOT NULL "
            + "ORDER BY g.createdAt ASC, g.id ASC")
    List<AccessGrant> findUserGrantsByDocumentIdIn(@Param("documentIds") Collection<UUID> documentIds);

    /** Positive direct grants of any principal, for shared-state projections. */
    @Query("SELECT g FROM AccessGrant g JOIN FETCH g.user JOIN FETCH g.document "
            + "WHERE g.document.id = :documentId AND g.user IS NOT NULL AND g.effect = "
            + "com.nextdocs.api.document.entity.AccessGrantEffect.ALLOW "
            + "ORDER BY g.createdAt ASC, g.id ASC")
    List<AccessGrant> findPositiveUserGrantsByDocumentId(@Param("documentId") UUID documentId);

    /** Batched positive direct user grants for restore walks. */
    @Query("SELECT g FROM AccessGrant g JOIN FETCH g.user JOIN FETCH g.document "
            + "WHERE g.document.id IN :documentIds AND g.user IS NOT NULL AND g.effect = "
            + "com.nextdocs.api.document.entity.AccessGrantEffect.ALLOW "
            + "ORDER BY g.createdAt ASC, g.id ASC")
    List<AccessGrant> findPositiveUserGrantsByDocumentIdIn(@Param("documentIds") Collection<UUID> documentIds);

    @Query("SELECT CASE WHEN COUNT(g) > 0 THEN TRUE ELSE FALSE END FROM AccessGrant g "
            + "WHERE g.document.id = :documentId AND g.effect = "
            + "com.nextdocs.api.document.entity.AccessGrantEffect.ALLOW")
    boolean existsPositiveGrantByDocumentId(@Param("documentId") UUID documentId);

    @Query("SELECT DISTINCT g.document.id FROM AccessGrant g "
            + "WHERE g.document.id IN :documentIds AND g.effect = "
            + "com.nextdocs.api.document.entity.AccessGrantEffect.ALLOW")
    List<UUID> findDocumentIdsWithPositiveGrants(@Param("documentIds") Collection<UUID> documentIds);

    /**
     * Whether the identity channel has any positive page grant on this document or its
     * ancestors. The grant store is authoritative, and group membership counts. Trash
     * is deliberately ignored, matching the breakpoint semantics.
     */
    String HAS_POSITIVE_IDENTITY_GRANT_SQL = "SELECT has_positive_identity_grant(:userId, :documentId)";

    @Query(value = HAS_POSITIVE_IDENTITY_GRANT_SQL, nativeQuery = true)
    boolean hasPositiveIdentityGrant(@Param("userId") UUID userId, @Param("documentId") UUID documentId);

    void deleteByDocument_IdAndUser_Id(UUID documentId, UUID userId);

    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM AccessGrant g WHERE g.workspace.id = :workspaceId AND g.user.id = :userId")
    int deleteUserGrantsByWorkspace(@Param("workspaceId") UUID workspaceId, @Param("userId") UUID userId);

    String DELETE_USER_GRANTS_IN_SPACE_SQL = "WITH RECURSIVE sub AS ("
            + "  SELECT id, 1 AS depth FROM documents WHERE space_id = :spaceId "
            + "  UNION ALL "
            + "  SELECT d.id, s.depth + 1 FROM documents d JOIN sub s ON d.parent_id = s.id "
            + "  WHERE s.depth < 100 "
            + ") "
            + "DELETE FROM access_grants g USING sub s "
            + "WHERE g.document_id = s.id AND g.user_id = :userId";

    /** Deletes a removed space member's direct ALLOW and DENY rows throughout the space. */
    @Modifying(flushAutomatically = true)
    @Query(value = DELETE_USER_GRANTS_IN_SPACE_SQL, nativeQuery = true)
    int deleteUserGrantsInSpace(@Param("spaceId") UUID spaceId, @Param("userId") UUID userId);

    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM AccessGrant g WHERE g.document.id = :documentId")
    void deleteGrantsByDocumentId(@Param("documentId") UUID documentId);

    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM AccessGrant g WHERE g.document.id IN :documentIds")
    void deleteGrantsByDocumentIdIn(@Param("documentIds") Collection<UUID> documentIds);

    /**
     * Deletes user DENY rows in a subtree that no longer have any positive identity grant
     * to shadow. A later re-grant must not revive a stale revocation.
     */
    String PRUNE_ORPHANED_BREAKPOINTS_SQL = "WITH RECURSIVE sub AS ("
            + "  SELECT id, 1 AS depth FROM documents WHERE id = :subtreeRootId "
            + "  UNION ALL "
            + "  SELECT d.id, s.depth + 1 FROM documents d JOIN sub s ON d.parent_id = s.id "
            + "  WHERE s.depth < 100 "
            + ") "
            + "DELETE FROM access_grants g "
            + "USING sub s "
            + "WHERE g.document_id = s.id "
            + "  AND g.user_id IS NOT NULL "
            + "  AND g.effect = 'DENY' "
            + "  AND NOT has_positive_identity_grant(g.user_id, s.id)";

    @Modifying(flushAutomatically = true)
    @Query(value = PRUNE_ORPHANED_BREAKPOINTS_SQL, nativeQuery = true)
    int pruneOrphanedBreakpoints(@Param("subtreeRootId") UUID subtreeRootId);

    /** Removes one user's user DENY rows from a subtree when their identity leaves it. */
    String DELETE_DENY_IN_SUBTREE_FOR_USER_SQL = "WITH RECURSIVE sub AS ("
            + "  SELECT id, 1 AS depth FROM documents WHERE id = :subtreeRootId "
            + "  UNION ALL "
            + "  SELECT d.id, s.depth + 1 FROM documents d JOIN sub s ON d.parent_id = s.id "
            + "  WHERE s.depth < 100 "
            + ") "
            + "DELETE FROM access_grants g "
            + "USING sub s "
            + "WHERE g.document_id = s.id "
            + "  AND g.user_id = :userId "
            + "  AND g.effect = 'DENY'";

    @Modifying(flushAutomatically = true)
    @Query(value = DELETE_DENY_IN_SUBTREE_FOR_USER_SQL, nativeQuery = true)
    int deleteDenyInSubtreeForUser(@Param("subtreeRootId") UUID subtreeRootId, @Param("userId") UUID userId);

    /**
     * Removes page audience rules from a subtree that is leaving its space. The rules
     * replace a space baseline, so carrying them into another container would apply a
     * setting nobody made there. Identity, group, and user grants are untouched.
     */
    @Modifying(flushAutomatically = true)
    @Query(
            value = "DELETE FROM access_grants "
                    + "WHERE audience IN ('SPACE_MEMBERS', 'SPACE_EVERYONE') "
                    + "AND document_id IN ("
                    + "  WITH RECURSIVE subtree AS ("
                    + "    SELECT id, 0 AS depth FROM documents WHERE id = :rootId"
                    + "    UNION ALL "
                    + "    SELECT d.id, s.depth + 1 FROM documents d "
                    + "    JOIN subtree s ON d.parent_id = s.id WHERE s.depth < 100"
                    + "  ) SELECT id FROM subtree"
                    + ")",
            nativeQuery = true)
    int deleteSpaceAudienceGrantsInSubtree(@Param("rootId") UUID rootId);
}
