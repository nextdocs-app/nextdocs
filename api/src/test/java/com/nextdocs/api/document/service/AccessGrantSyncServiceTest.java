package com.nextdocs.api.document.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.document.entity.AccessGrant;
import com.nextdocs.api.document.entity.AccessGrantEffect;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.repository.AccessGrantRepository;
import com.nextdocs.api.workspace.entity.Workspace;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class AccessGrantSyncServiceTest {

    @Mock
    private AccessGrantRepository repository;

    private AccessGrantSyncService service;
    private Workspace workspace;
    private Document document;
    private User target;
    private User actor;

    @BeforeEach
    void setUp() {
        service = new AccessGrantSyncService(repository);
        workspace = Workspace.builder().id(UUID.randomUUID()).name("Workspace").build();
        document = Document.builder()
                .id(UUID.randomUUID())
                .workspace(workspace)
                .user(User.builder().id(UUID.randomUUID()).build())
                .build();
        target =
                User.builder().id(UUID.randomUUID()).email("target@example.com").build();
        actor = User.builder().id(UUID.randomUUID()).email("actor@example.com").build();
    }

    @Test
    void upsertUserGrant_rejectsDocumentsWithoutWorkspace() {
        Document noWorkspaceDoc = Document.builder()
                .id(UUID.randomUUID())
                .user(User.builder().id(UUID.randomUUID()).build())
                .build();

        assertThrows(
                IllegalStateException.class,
                () -> service.upsertUserGrant(noWorkspaceDoc, target, DocumentAccessLevel.VIEW, target));
        verifyNoInteractions(repository);
    }

    @Test
    void upsertUserGrant_createsNewGrantWithAllowLevelAndActorAsCreatedBy() {
        when(repository.findByDocument_IdAndUser_Id(document.getId(), target.getId()))
                .thenReturn(Optional.empty());
        when(repository.save(any(AccessGrant.class))).thenAnswer(invocation -> invocation.getArgument(0));

        AccessGrant result = service.upsertUserGrant(document, target, DocumentAccessLevel.EDIT, actor);

        ArgumentCaptor<AccessGrant> captor = ArgumentCaptor.forClass(AccessGrant.class);
        verify(repository).save(captor.capture());
        AccessGrant saved = captor.getValue();

        assertThat(saved.getWorkspace()).isEqualTo(workspace);
        assertThat(saved.getDocument()).isEqualTo(document);
        assertThat(saved.getUser()).isEqualTo(target);
        assertThat(saved.getEffect()).isEqualTo(AccessGrantEffect.ALLOW);
        assertThat(saved.getAccessLevel()).isEqualTo(DocumentAccessLevel.EDIT);
        assertThat(saved.getCreatedBy()).isEqualTo(actor);
        assertThat(result).isSameAs(saved);
    }

    @Test
    void upsertUserGrant_updatesExistingGrantAndPreservesCreatedBy() {
        User originalAuthor = User.builder().id(UUID.randomUUID()).build();
        AccessGrant existing = AccessGrant.builder()
                .id(UUID.randomUUID())
                .workspace(workspace)
                .document(document)
                .user(target)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.VIEW)
                .createdBy(originalAuthor)
                .build();

        when(repository.findByDocument_IdAndUser_Id(document.getId(), target.getId()))
                .thenReturn(Optional.of(existing));
        when(repository.save(any(AccessGrant.class))).thenAnswer(invocation -> invocation.getArgument(0));

        AccessGrant result = service.upsertUserGrant(document, target, DocumentAccessLevel.COMMENT, actor);

        assertThat(result.getEffect()).isEqualTo(AccessGrantEffect.ALLOW);
        assertThat(result.getAccessLevel()).isEqualTo(DocumentAccessLevel.COMMENT);
        assertThat(result.getCreatedBy()).isEqualTo(originalAuthor);
    }

    @Test
    void upsertUserGrant_noAccessMapsToDenyWithNullAccessLevelAndFallbackActor() {
        when(repository.findByDocument_IdAndUser_Id(document.getId(), target.getId()))
                .thenReturn(Optional.empty());
        when(repository.save(any(AccessGrant.class))).thenAnswer(invocation -> invocation.getArgument(0));

        AccessGrant result = service.upsertUserGrant(document, target, DocumentAccessLevel.NO_ACCESS, null);

        assertThat(result.getEffect()).isEqualTo(AccessGrantEffect.DENY);
        assertThat(result.getAccessLevel()).isNull();
        assertThat(result.getCreatedBy()).isEqualTo(target);
    }

    @Test
    void deleteUserGrant_delegatesToRepository() {
        UUID docId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();

        service.deleteUserGrant(docId, userId);

        verify(repository).deleteByDocument_IdAndUser_Id(docId, userId);
    }
}
