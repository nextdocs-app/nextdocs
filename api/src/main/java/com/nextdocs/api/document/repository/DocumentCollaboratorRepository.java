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

    void deleteByDocument_IdAndUser_Id(UUID documentId, UUID userId);
}
