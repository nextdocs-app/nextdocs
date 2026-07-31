package com.nextdocs.api.document.repository;

import com.nextdocs.api.document.entity.UserDocumentOrder;
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
public interface UserDocumentOrderRepository extends JpaRepository<UserDocumentOrder, UUID> {

    Optional<UserDocumentOrder> findByUser_IdAndDocument_Id(UUID userId, UUID documentId);

    boolean existsByUser_IdAndDocument_Id(UUID userId, UUID documentId);

    boolean existsByUser_IdAndOrderKey(UUID userId, String orderKey);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("DELETE FROM UserDocumentOrder udo WHERE udo.user.id = :userId AND udo.document.id = :documentId")
    void deleteByUser_IdAndDocument_Id(@Param("userId") UUID userId, @Param("documentId") UUID documentId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("DELETE FROM UserDocumentOrder udo WHERE udo.document.id = :documentId")
    void deleteByDocument_Id(@Param("documentId") UUID documentId);

    @Query("SELECT MAX(udo.orderKey) FROM UserDocumentOrder udo "
            + "WHERE udo.user.id = :userId AND udo.document.deletedAt IS NULL AND udo.document.id <> :excludeDocId")
    Optional<String> findMaxOrderKeyByUserId(@Param("userId") UUID userId, @Param("excludeDocId") UUID excludeDocId);

    @Query("SELECT MAX(udo.orderKey) FROM UserDocumentOrder udo "
            + "WHERE udo.user.id = :userId AND udo.document.deletedAt IS NULL "
            + "AND udo.document.id <> :excludeDocId AND udo.orderKey < :key")
    Optional<String> findMaxOrderKeyLessThan(
            @Param("userId") UUID userId, @Param("key") String key, @Param("excludeDocId") UUID excludeDocId);

    @Query("SELECT MIN(udo.orderKey) FROM UserDocumentOrder udo "
            + "WHERE udo.user.id = :userId AND udo.document.deletedAt IS NULL "
            + "AND udo.document.id <> :excludeDocId AND udo.orderKey > :key")
    Optional<String> findMinOrderKeyGreaterThan(
            @Param("userId") UUID userId, @Param("key") String key, @Param("excludeDocId") UUID excludeDocId);

    @Query("SELECT MIN(udo.orderKey) FROM UserDocumentOrder udo "
            + "WHERE udo.user.id = :userId AND udo.document.deletedAt IS NULL AND udo.document.id <> :excludeDocId")
    Optional<String> findMinOrderKeyByUserId(@Param("userId") UUID userId, @Param("excludeDocId") UUID excludeDocId);

    @Query("SELECT udo.orderKey FROM UserDocumentOrder udo "
            + "WHERE udo.user.id = :userId AND udo.document.id = :documentId AND udo.document.deletedAt IS NULL")
    Optional<String> findOrderKeyByUserIdAndDocumentId(
            @Param("userId") UUID userId, @Param("documentId") UUID documentId);

    @Query("SELECT udo.document.id, udo.orderKey FROM UserDocumentOrder udo "
            + "WHERE udo.user.id = :userId AND udo.document.id IN :documentIds AND udo.document.deletedAt IS NULL")
    List<Object[]> findOrderKeysByUserIdAndDocumentIds(
            @Param("userId") UUID userId, @Param("documentIds") Collection<UUID> documentIds);

    @Query("SELECT udo FROM UserDocumentOrder udo "
            + "WHERE udo.user.id = :userId "
            + "ORDER BY udo.orderKey ASC, udo.createdAt ASC, udo.id ASC")
    List<UserDocumentOrder> findAllForReindex(@Param("userId") UUID userId);
}
