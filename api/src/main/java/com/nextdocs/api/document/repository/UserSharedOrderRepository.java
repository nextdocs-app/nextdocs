package com.nextdocs.api.document.repository;

import com.nextdocs.api.document.entity.UserSharedOrder;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

/** Personal order rows for the Shared section. Mirrors {@link UserDocumentOrderRepository}. */
@Repository
public interface UserSharedOrderRepository extends JpaRepository<UserSharedOrder, UUID> {

    Optional<UserSharedOrder> findByUser_IdAndDocument_Id(UUID userId, UUID documentId);

    boolean existsByUser_IdAndDocument_Id(UUID userId, UUID documentId);

    boolean existsByUser_IdAndOrderKey(UUID userId, String orderKey);

    /**
     * Document ids that already hold a Shared row for this user, trashed pages included:
     * a soft-deleted page keeps its position until purge, and treating that row as missing
     * would insert a duplicate (user, document) row.
     */
    @Query("SELECT udo.document.id FROM UserSharedOrder udo "
            + "WHERE udo.user.id = :userId AND udo.document.id IN :documentIds")
    List<UUID> findExistingDocumentIdsByUserIdAndDocumentIds(
            @Param("userId") UUID userId, @Param("documentIds") Collection<UUID> documentIds);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("DELETE FROM UserSharedOrder udo WHERE udo.user.id = :userId AND udo.document.id = :documentId")
    void deleteByUser_IdAndDocument_Id(@Param("userId") UUID userId, @Param("documentId") UUID documentId);

    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM UserSharedOrder udo WHERE udo.document.id IN :documentIds")
    void deleteByDocument_IdIn(@Param("documentIds") Collection<UUID> documentIds);

    @Query("SELECT udo.orderKey FROM UserSharedOrder udo WHERE udo.user.id = :userId")
    List<String> findAllOrderKeysByUserId(@Param("userId") UUID userId);

    // Trashed rows stay in the key space until purge: soft delete removes Private rows
    // only. The neighbour and min/max reads therefore include them. A key computed against
    // the live rows alone can equal a trashed row's key, and the (user, order_key) unique
    // constraint rejects the insert until a reindex re-spaces the section.
    @Query("SELECT MAX(udo.orderKey) FROM UserSharedOrder udo "
            + "WHERE udo.user.id = :userId AND udo.document.id <> :excludeDocId")
    Optional<String> findMaxOrderKeyByUserId(@Param("userId") UUID userId, @Param("excludeDocId") UUID excludeDocId);

    @Query("SELECT MAX(udo.orderKey) FROM UserSharedOrder udo "
            + "WHERE udo.user.id = :userId "
            + "AND udo.document.id <> :excludeDocId AND udo.orderKey < :key")
    Optional<String> findMaxOrderKeyLessThan(
            @Param("userId") UUID userId, @Param("key") String key, @Param("excludeDocId") UUID excludeDocId);

    @Query("SELECT MIN(udo.orderKey) FROM UserSharedOrder udo "
            + "WHERE udo.user.id = :userId "
            + "AND udo.document.id <> :excludeDocId AND udo.orderKey > :key")
    Optional<String> findMinOrderKeyGreaterThan(
            @Param("userId") UUID userId, @Param("key") String key, @Param("excludeDocId") UUID excludeDocId);

    @Query("SELECT MIN(udo.orderKey) FROM UserSharedOrder udo "
            + "WHERE udo.user.id = :userId AND udo.document.id <> :excludeDocId")
    Optional<String> findMinOrderKeyByUserId(@Param("userId") UUID userId, @Param("excludeDocId") UUID excludeDocId);

    @Query("SELECT udo.orderKey FROM UserSharedOrder udo "
            + "WHERE udo.user.id = :userId AND udo.document.id = :documentId AND udo.document.deletedAt IS NULL")
    Optional<String> findOrderKeyByUserIdAndDocumentId(
            @Param("userId") UUID userId, @Param("documentId") UUID documentId);

    @Query("SELECT udo.document.id, udo.orderKey FROM UserSharedOrder udo "
            + "WHERE udo.user.id = :userId AND udo.document.id IN :documentIds AND udo.document.deletedAt IS NULL")
    List<Object[]> findOrderKeysByUserIdAndDocumentIds(
            @Param("userId") UUID userId, @Param("documentIds") Collection<UUID> documentIds);

    /** Trashed rows stay in the key space until purge, so they must be re-spaced too. */
    @Query("SELECT udo FROM UserSharedOrder udo "
            + "WHERE udo.user.id = :userId "
            + "ORDER BY udo.orderKey ASC, udo.createdAt ASC, udo.id ASC")
    List<UserSharedOrder> findAllForReindex(@Param("userId") UUID userId);
}
