package com.nextdocs.api.audit.service;

import com.nextdocs.api.audit.entity.AccessAudit;
import com.nextdocs.api.audit.entity.AccessAuditAction;
import com.nextdocs.api.audit.repository.AccessAuditRepository;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.space.entity.Space;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * Writes the access audit row in the same transaction as the mutation it describes.
 *
 * <p>This lives beside the permission services rather than inside each of them so the
 * action vocabulary and the tenant/document/space columns stay one concept. Calls are
 * deliberately fire-and-record: a failed audit write rolls the mutation back. Document
 * rows without a workspace are legacy or test fixtures; the audit schema requires a tenant,
 * so those rows are skipped until they are backfilled.
 */
@Service
@RequiredArgsConstructor
public class AccessAuditService {

    private static final int MAX_DETAIL_LENGTH = 1024;

    private final AccessAuditRepository repository;

    public void recordDocument(
            Document document,
            UUID actorId,
            AccessAuditAction action,
            String principalType,
            UUID principalId,
            String detail) {
        if (document.getWorkspace() == null) {
            // No tenant can be recorded; V31 backfills production rows and requires one.
            return;
        }
        record(
                document.getWorkspace().getId(),
                document.getId(),
                null,
                actorId,
                action,
                principalType,
                principalId,
                detail);
    }

    public void recordSpace(
            Space space,
            UUID actorId,
            AccessAuditAction action,
            String principalType,
            UUID principalId,
            String detail) {
        record(space.getWorkspace().getId(), null, space.getId(), actorId, action, principalType, principalId, detail);
    }

    public void record(
            UUID workspaceId,
            UUID documentId,
            UUID spaceId,
            UUID actorId,
            AccessAuditAction action,
            String principalType,
            UUID principalId,
            String detail) {
        repository.save(AccessAudit.builder()
                .workspaceId(workspaceId)
                .documentId(documentId)
                .spaceId(spaceId)
                .actorUserId(actorId)
                .action(action)
                .principalType(principalType)
                .principalId(principalId)
                .detail(truncate(detail))
                .build());
    }

    private static String truncate(String detail) {
        return detail == null || detail.length() <= MAX_DETAIL_LENGTH ? detail : detail.substring(0, MAX_DETAIL_LENGTH);
    }
}
