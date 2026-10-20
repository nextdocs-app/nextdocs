package com.nextdocs.api.attachment.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.nextdocs.api.attachment.AttachmentScope;
import com.nextdocs.api.attachment.entity.Attachment;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.repository.WorkspaceRepository;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class AttachmentScopeBinderTest {

    @Mock
    private DocumentRepository documentRepository;

    @Mock
    private WorkspaceRepository workspaceRepository;

    private AttachmentScopeBinder binder;

    @BeforeEach
    void setUp() {
        binder = new AttachmentScopeBinder(documentRepository, workspaceRepository);
    }

    @Test
    void documentScope_bindsTheDocumentReference() {
        UUID documentId = UUID.randomUUID();
        Document document = Document.builder().id(documentId).title("Doc").build();
        when(documentRepository.getReferenceById(documentId)).thenReturn(document);

        Attachment attachment = binder.bind(Attachment.builder(), AttachmentScope.document(documentId))
                .build();

        assertThat(attachment.getDocument()).isSameAs(document);
        assertThat(attachment.getWorkspace()).isNull();
    }

    @Test
    void workspaceScope_bindsTheWorkspaceReference() {
        UUID workspaceId = UUID.randomUUID();
        Workspace workspace =
                Workspace.builder().id(workspaceId).name("NextDocs").build();
        when(workspaceRepository.getReferenceById(workspaceId)).thenReturn(workspace);

        Attachment attachment = binder.bind(Attachment.builder(), AttachmentScope.workspace(workspaceId))
                .build();

        assertThat(attachment.getWorkspace()).isSameAs(workspace);
        assertThat(attachment.getDocument()).isNull();
    }
}
