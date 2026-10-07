package com.nextdocs.api.document.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.when;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.document.dto.request.CollaboratorAccessUpdateRequest;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.entity.UserDocumentOrder;
import com.nextdocs.api.document.repository.DocumentCollaboratorRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.repository.UserDocumentOrderRepository;
import jakarta.persistence.EntityManager;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

/**
 * Guards the shared-root reconciliation against persistence-context clears: the order row deletes
 * carry {@code clearAutomatically}, so any lazy association resolved after the first delete throws
 * {@code LazyInitializationException}. That behaviour only reproduces against a real Hibernate
 * session, hence a Spring Boot test instead of mocks.
 *
 * <p>Permission resolution and collaborator rows stay mocked: they run on Postgres-native SQL
 * functions that H2 does not provide.
 */
@SpringBootTest
class DocumentSharingReconcilePersistenceTest {

    @Autowired
    private DocumentSharingService sharingService;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private UserDocumentOrderRepository userDocumentOrderRepository;

    @Autowired
    private EntityManager entityManager;

    @MockitoSpyBean
    private DocumentRepository documentRepository;

    @MockitoBean
    private PermissionService permissionService;

    @MockitoBean
    private DocumentCollaboratorRepository collaboratorRepository;

    @Test
    void updateCollaboratorAccess_resolvesLazyAssociationsBeforeOrderRowDeletes() {
        User owner = userRepository.saveAndFlush(User.builder()
                .email("owner-reconcile@example.com")
                .displayName("Owner")
                .build());
        User bob = userRepository.saveAndFlush(User.builder()
                .email("bob-reconcile@example.com")
                .displayName("Bob")
                .build());

        Document grandparent = documentRepository.saveAndFlush(Document.builder()
                .id(UUID.randomUUID())
                .user(owner)
                .title("Grandparent")
                .yjsState("seed".getBytes(StandardCharsets.UTF_8))
                .build());
        Document root = documentRepository.saveAndFlush(Document.builder()
                .id(UUID.randomUUID())
                .user(owner)
                .parent(grandparent)
                .title("Root")
                .yjsState("seed".getBytes(StandardCharsets.UTF_8))
                .build());
        Document child = documentRepository.saveAndFlush(Document.builder()
                .id(UUID.randomUUID())
                .user(owner)
                .parent(root)
                .title("Child")
                .yjsState("seed".getBytes(StandardCharsets.UTF_8))
                .build());

        // Bob floated the child earlier; overriding his access on the root has to drop that row
        // (he reaches the child through the root) while floating the root (its parent is not
        // accessible to him).
        userDocumentOrderRepository.saveAndFlush(UserDocumentOrder.builder()
                .user(bob)
                .document(child)
                .orderKey("b0")
                .build());

        when(permissionService.requireSharingAdminAccess(owner.getId(), root.getId()))
                .thenReturn(root);
        when(permissionService.resolveAccessBatch(
                        bob.getId(), java.util.Set.of(child.getId(), root.getId(), grandparent.getId())))
                .thenReturn(java.util.Map.of(
                        child.getId(), DocumentAccessLevel.VIEW, root.getId(), DocumentAccessLevel.VIEW));

        when(collaboratorRepository.hasPositiveAncestorGrant(bob.getId(), root.getId()))
                .thenReturn(true);
        when(collaboratorRepository.findByDocument_IdAndUser_Id(root.getId(), bob.getId()))
                .thenReturn(Optional.empty());
        when(collaboratorRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        // Process the child first so its order row delete clears the persistence context before
        // the root's detached parent proxy is resolved. Batch loads delegate to the
        // transaction-bound EntityManager so the real proxies take part in the flow.
        doReturn(List.of(child.getId(), root.getId())).when(documentRepository).findSubtreeDocumentIds(root.getId());
        doAnswer(inv -> {
                    java.util.Collection<UUID> ids = inv.getArgument(0);
                    return ids.stream()
                            .map(id -> entityManager.find(Document.class, id))
                            .toList();
                })
                .when(documentRepository)
                .findAllWithUserByIdIn(any());
        doAnswer(inv -> {
                    java.util.Collection<UUID> ids = inv.getArgument(0);
                    return ids.stream()
                            .map(id -> {
                                Document doc = entityManager.find(Document.class, id);
                                Document parent = doc.getParent();
                                return new Object[] {id, parent != null ? parent.getId() : null};
                            })
                            .toList();
                })
                .when(documentRepository)
                .findParentIdsByIdIn(any());

        sharingService.updateCollaboratorAccess(
                owner.getId(),
                root.getId(),
                bob.getId(),
                new CollaboratorAccessUpdateRequest(DocumentAccessLevel.EDIT));

        assertThat(userDocumentOrderRepository.existsByUser_IdAndDocument_Id(bob.getId(), root.getId()))
                .isTrue();
        assertThat(userDocumentOrderRepository.existsByUser_IdAndDocument_Id(bob.getId(), child.getId()))
                .isFalse();
    }
}
