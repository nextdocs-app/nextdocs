package com.nextdocs.api.document.repository;

import com.nextdocs.api.document.entity.Document;
import java.time.OffsetDateTime;
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

    Page<Document> findAllByUser_IdAndDeletedAtIsNotNull(UUID userId, Pageable pageable);

    Optional<Document> findByIdAndUser_IdAndDeletedAtIsNull(UUID id, UUID userId);

    Optional<Document> findByIdAndUser_Id(UUID id, UUID userId);

    Optional<Document> findByIdAndUser_IdAndDeletedAtIsNotNull(UUID id, UUID userId);

    Optional<Document> findByIdAndDeletedAtIsNull(UUID id);

    @Query("SELECT d FROM Document d "
            + "JOIN DocumentCollaborator c ON c.document.id = d.id "
            + "WHERE c.user.id = :userId AND d.deletedAt IS NULL "
            + "ORDER BY d.updatedAt DESC, d.createdAt DESC, d.id ASC")
    Page<Document> findSharedWithUserId(@Param("userId") UUID userId, Pageable pageable);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("DELETE FROM Document d WHERE d.deletedAt IS NOT NULL AND d.deletedAt < :cutoff")
    int deleteExpiredTrash(@Param("cutoff") OffsetDateTime cutoff);
}
