package com.nextdocs.api.attachment.service;

import com.nextdocs.api.attachment.AttachmentScope;
import com.nextdocs.api.attachment.entity.Attachment;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.workspace.repository.WorkspaceRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * Attaches a new row to the foreign key its scope names. The references are lazy
 * proxies on purpose: the scope's row was already loaded and authorized by the
 * access policy, so binding only needs the id to write.
 */
@Component
@RequiredArgsConstructor
public class AttachmentScopeBinder {

    private final DocumentRepository documentRepository;
    private final WorkspaceRepository workspaceRepository;

    public Attachment.AttachmentBuilder bind(Attachment.AttachmentBuilder builder, AttachmentScope scope) {
        return switch (scope.kind()) {
            case DOCUMENT -> builder.document(documentRepository.getReferenceById(scope.id()));
            case WORKSPACE -> builder.workspace(workspaceRepository.getReferenceById(scope.id()));
        };
    }
}
