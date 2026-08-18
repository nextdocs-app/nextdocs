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

    boolean existsByDocument_Id(UUID documentId);

    void deleteByDocument_IdAndUser_Id(UUID documentId, UUID userId);

    @org.springframework.data.jpa.repository.Modifying(clearAutomatically = true, flushAutomatically = true)
    @org.springframework.data.jpa.repository.Query(
            "DELETE FROM DocumentCollaborator c WHERE c.document.id = :documentId")
    void deleteByDocument_Id(@org.springframework.data.repository.query.Param("documentId") UUID documentId);

    @org.springframework.data.jpa.repository.Query(
            "SELECT DISTINCT c.document.id FROM DocumentCollaborator c WHERE c.document.id IN :documentIds")
    List<UUID> findDocumentIdsWithCollaborators(
            @org.springframework.data.repository.query.Param("documentIds") java.util.Collection<UUID> documentIds);
}
