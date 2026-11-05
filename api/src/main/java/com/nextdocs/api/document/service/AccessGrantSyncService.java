package com.nextdocs.api.document.service;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.document.entity.AccessGrant;
import com.nextdocs.api.document.entity.AccessGrantEffect;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.repository.AccessGrantRepository;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Writes user grants to the canonical page-grant store. */
@Service
@RequiredArgsConstructor
public class AccessGrantSyncService {

    private final AccessGrantRepository repository;

    /** Creates or updates the canonical user grant. */
    @Transactional
    public AccessGrant upsertUserGrant(Document document, User user, DocumentAccessLevel level, User actor) {
        if (document.getWorkspace() == null) {
            throw new IllegalStateException("A document workspace is required to persist a page grant.");
        }
        AccessGrant grant = repository
                .findByDocument_IdAndUser_Id(document.getId(), user.getId())
                .orElseGet(() -> AccessGrant.builder()
                        .workspace(document.getWorkspace())
                        .document(document)
                        .user(user)
                        .build());
        applyLevel(grant, level);
        if (grant.getCreatedBy() == null) {
            grant.setCreatedBy(actor != null ? actor : user);
        }
        return repository.save(grant);
    }

    private static void applyLevel(AccessGrant grant, DocumentAccessLevel level) {
        if (level == DocumentAccessLevel.NO_ACCESS) {
            grant.setEffect(AccessGrantEffect.DENY);
            grant.setAccessLevel(null);
        } else {
            grant.setEffect(AccessGrantEffect.ALLOW);
            grant.setAccessLevel(level);
        }
    }

    @Transactional
    public void deleteUserGrant(UUID documentId, UUID userId) {
        repository.deleteByDocument_IdAndUser_Id(documentId, userId);
    }
}
