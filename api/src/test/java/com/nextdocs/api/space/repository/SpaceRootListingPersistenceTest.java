package com.nextdocs.api.space.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.space.entity.Space;
import com.nextdocs.api.space.entity.SpaceAccessMode;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.repository.WorkspaceRepository;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;

/**
 * Guards the crux of the spaces design against the real JPQL: a page filed into a space
 * must disappear from the Private, Shared, and "all roots" listings while every page
 * without a space keeps its place there. Mocked query-helper tests cannot see this,
 * because the predicate lives in the repository query itself.
 */
@SpringBootTest
class SpaceRootListingPersistenceTest {

    @Autowired
    private DocumentRepository documentRepository;

    @Autowired
    private SpaceRepository spaceRepository;

    @Autowired
    private WorkspaceRepository workspaceRepository;

    @Autowired
    private UserRepository userRepository;

    private Document page(User owner, Space space, String title) {
        return documentRepository.saveAndFlush(Document.builder()
                .id(UUID.randomUUID())
                .user(owner)
                .space(space)
                .title(title)
                .yjsState("seed".getBytes(StandardCharsets.UTF_8))
                .build());
    }

    @Test
    void rootListings_keepSpacePagesOutOfPrivateAndAll() {
        User owner = userRepository.saveAndFlush(User.builder()
                .email("space-listing-" + UUID.randomUUID() + "@example.com")
                .displayName("Owner")
                .build());
        Workspace workspace = workspaceRepository.saveAndFlush(
                Workspace.builder().name("NextDocs").build());
        Space space = spaceRepository.saveAndFlush(Space.builder()
                .workspace(workspace)
                .name("Engineering")
                .accessMode(SpaceAccessMode.CUSTOM)
                .build());

        Document privatePage = page(owner, null, "Private Page");
        Document spacePage = page(owner, space, "Space Page");

        List<UUID> privateIds =
                documentRepository.findPrivateRootDocuments(owner.getId(), PageRequest.of(0, 50)).getContent().stream()
                        .map(row -> ((Document) row[0]).getId())
                        .toList();
        assertThat(privateIds).containsExactly(privatePage.getId());

        List<UUID> allRootIds =
                documentRepository.findAllRootDocuments(owner.getId(), PageRequest.of(0, 50)).getContent().stream()
                        .map(row -> ((Document) row[0]).getId())
                        .toList();
        assertThat(allRootIds).containsExactly(privatePage.getId());

        List<UUID> sharedIds =
                documentRepository.findSharedRootDocuments(owner.getId(), PageRequest.of(0, 50)).getContent().stream()
                        .map(row -> ((Document) row[0]).getId())
                        .toList();
        assertThat(sharedIds).isEmpty();

        // The space's own listing runs resolve_effective_access, so it is pinned against
        // PostgreSQL in SpacePermissionMigrationPostgresTest; the count is plain SQL.
        assertThat(documentRepository.countBySpace_IdAndDeletedAtIsNull(space.getId()))
                .isEqualTo(1);
    }
}
