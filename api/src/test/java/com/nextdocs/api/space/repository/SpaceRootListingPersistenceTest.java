package com.nextdocs.api.space.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.nextdocs.api.document.entity.AccessGrant;
import com.nextdocs.api.document.entity.AccessGrantEffect;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.entity.DocumentWorkspaceAccessMode;
import com.nextdocs.api.document.repository.AccessGrantRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.space.entity.Space;
import com.nextdocs.api.space.entity.SpaceAccessMode;
import com.nextdocs.api.space.entity.SpaceMember;
import com.nextdocs.api.space.entity.UserSpaceOrder;
import com.nextdocs.api.user.entity.User;
import com.nextdocs.api.user.repository.UserRepository;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import com.nextdocs.api.workspace.repository.WorkspaceRepository;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.transaction.annotation.Transactional;

/**
 * Guards the crux of the spaces design against the real JPQL: a page filed into a space
 * must disappear from the Private listing while every page without a space keeps its
 * place there. The "all roots" query resolves effective access in SQL, so it is pinned on
 * PostgreSQL in RosterVisibilityE2ETest instead. Mocked query-helper tests cannot see
 * this, because the predicate lives in the repository query itself.
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

    @Autowired
    private SpaceMemberRepository spaceMemberRepository;

    @Autowired
    private WorkspaceMemberRepository workspaceMemberRepository;

    @Autowired
    private AccessGrantRepository accessGrantRepository;

    @Autowired
    private UserSpaceOrderRepository userSpaceOrderRepository;

    private Document page(User owner, Space space, String title) {
        return documentRepository.saveAndFlush(Document.builder()
                .id(UUID.randomUUID())
                .creator(owner)
                .space(space)
                .workspace(space == null ? null : space.getWorkspace())
                .title(title)
                .build());
    }

    private Document workspacePage(User owner, Workspace workspace, String title) {
        return documentRepository.saveAndFlush(Document.builder()
                .id(UUID.randomUUID())
                .creator(owner)
                .workspace(workspace)
                .title(title)
                .build());
    }

    @Test
    void privateRootListing_keepsSpacePagesOut() {
        User owner = userRepository.saveAndFlush(User.builder()
                .email("space-listing-" + UUID.randomUUID() + "@example.com")
                .displayName("Owner")
                .passwordHash("$2a$12$hash")
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
        accessGrantRepository.saveAndFlush(AccessGrant.builder()
                .workspace(workspace)
                .document(privatePage)
                .user(owner)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.OWNER)
                .build());

        List<UUID> privateIds =
                documentRepository.findPrivateRootDocuments(owner.getId(), PageRequest.of(0, 50)).getContent().stream()
                        .map(row -> ((Document) row[0]).getId())
                        .toList();
        assertThat(privateIds).containsExactly(privatePage.getId());

        // The all-roots and Shared-section candidate queries both resolve access in SQL
        // with resolve_effective_access, which H2 cannot execute. They are pinned on
        // PostgreSQL in RosterVisibilityE2ETest and SharedSectionCandidatePostgresTest;
        // the count below is plain SQL.
        assertThat(documentRepository.countBySpace_Id(space.getId())).isEqualTo(1);
    }

    @Test
    void workspaceSharedRoot_isListedOnceInSharedAndNeverInThePrivateList() {
        User owner = userRepository.saveAndFlush(User.builder()
                .email("workspace-audience-" + UUID.randomUUID() + "@example.com")
                .displayName("Owner")
                .passwordHash("$2a$12$hash")
                .build());
        Workspace workspace = workspaceRepository.saveAndFlush(
                Workspace.builder().name("NextDocs").build());
        // The audience is the workspace itself, so there is no AccessGrant row to see.
        // That is what made the web-side single-home filter keep this root in the flat
        // listing while the server listed it in Shared: two homes, one document.
        Document workspaceShared = documentRepository.saveAndFlush(Document.builder()
                .id(UUID.randomUUID())
                .creator(owner)
                .workspace(workspace)
                .workspaceAccessMode(DocumentWorkspaceAccessMode.WORKSPACE_MEMBERS)
                .title("Handbook")
                .build());
        Document privateRoot = documentRepository.saveAndFlush(Document.builder()
                .id(UUID.randomUUID())
                .creator(owner)
                .workspace(workspace)
                .title("Notes")
                .build());

        accessGrantRepository.saveAndFlush(AccessGrant.builder()
                .workspace(workspace)
                .document(workspaceShared)
                .user(owner)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.OWNER)
                .build());
        accessGrantRepository.saveAndFlush(AccessGrant.builder()
                .workspace(workspace)
                .document(privateRoot)
                .user(owner)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.OWNER)
                .build());

        assertThat(accessGrantRepository.findDocumentIdsWithPositiveGrants(List.of(workspaceShared.getId())))
                .containsExactly(workspaceShared.getId());

        List<UUID> privateIds =
                documentRepository.findPrivateRootDocuments(owner.getId(), PageRequest.of(0, 50)).getContent().stream()
                        .map(row -> ((Document) row[0]).getId())
                        .toList();
        assertThat(privateIds).containsExactly(privateRoot.getId());

        // The Shared-section candidate query needs the PostgreSQL resolver, so
        // SharedSectionCandidatePostgresTest pins that this root is listed once.
    }

    @Test
    @Transactional
    void workspaceMemberOffboarding_removesAllowAndDenyGrantsOnlyFromThatWorkspace() {
        User owner = userRepository.saveAndFlush(User.builder()
                .email("offboard-owner-" + UUID.randomUUID() + "@example.com")
                .displayName("Owner")
                .passwordHash("$2a$12$hash")
                .build());
        User member = userRepository.saveAndFlush(User.builder()
                .email("offboard-member-" + UUID.randomUUID() + "@example.com")
                .displayName("Member")
                .passwordHash("$2a$12$hash")
                .build());
        Workspace workspace = workspaceRepository.saveAndFlush(
                Workspace.builder().name("NextDocs").build());
        Workspace otherWorkspace = workspaceRepository.saveAndFlush(
                Workspace.builder().name("Other").build());
        Document allowedPage = workspacePage(owner, workspace, "Allowed");
        Document deniedPage = workspacePage(owner, workspace, "Denied");
        Document otherPage = workspacePage(owner, otherWorkspace, "Other workspace");

        accessGrantRepository.saveAndFlush(AccessGrant.builder()
                .workspace(workspace)
                .document(allowedPage)
                .user(member)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.VIEW)
                .build());
        accessGrantRepository.saveAndFlush(AccessGrant.builder()
                .workspace(workspace)
                .document(deniedPage)
                .user(member)
                .effect(AccessGrantEffect.DENY)
                .build());
        accessGrantRepository.saveAndFlush(AccessGrant.builder()
                .workspace(otherWorkspace)
                .document(otherPage)
                .user(member)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.EDIT)
                .build());

        assertThat(accessGrantRepository.deleteUserGrantsByWorkspace(workspace.getId(), member.getId()))
                .isEqualTo(2);
        assertThat(accessGrantRepository.findByDocument_IdAndUser_Id(allowedPage.getId(), member.getId()))
                .isEmpty();
        assertThat(accessGrantRepository.findByDocument_IdAndUser_Id(deniedPage.getId(), member.getId()))
                .isEmpty();
        assertThat(accessGrantRepository.findByDocument_IdAndUser_Id(otherPage.getId(), member.getId()))
                .isPresent();
    }

    @Test
    @Transactional
    void countSolelyOwnedStandaloneRoots_includesTrashedStandaloneRoots() {
        User soleOwner = userRepository.saveAndFlush(User.builder()
                .email("sole-trashed-owner-" + UUID.randomUUID() + "@example.com")
                .displayName("Sole Owner")
                .passwordHash("$2a$12$hash")
                .build());
        Workspace workspace = workspaceRepository.saveAndFlush(
                Workspace.builder().name("NextDocs").build());
        Document trashedRoot = documentRepository.saveAndFlush(Document.builder()
                .id(UUID.randomUUID())
                .workspace(workspace)
                .creator(soleOwner)
                .title("Trashed Root")
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build());
        accessGrantRepository.saveAndFlush(AccessGrant.builder()
                .workspace(workspace)
                .document(trashedRoot)
                .user(soleOwner)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.OWNER)
                .build());

        assertThat(accessGrantRepository.countSolelyOwnedStandaloneRoots(workspace.getId(), soleOwner.getId()))
                .isEqualTo(1L);
    }

    @Test
    void spacePageCounts_includePagesInTrash() {
        User owner = userRepository.saveAndFlush(User.builder()
                .email("space-count-" + UUID.randomUUID() + "@example.com")
                .displayName("Owner")
                .passwordHash("$2a$12$hash")
                .build());
        Workspace workspace = workspaceRepository.saveAndFlush(
                Workspace.builder().name("NextDocs").build());
        Space space = spaceRepository.saveAndFlush(Space.builder()
                .workspace(workspace)
                .name("Engineering")
                .accessMode(SpaceAccessMode.CUSTOM)
                .build());

        page(owner, space, "Active");
        Document trashed = page(owner, space, "Trashed");
        trashed.setDeletedAt(OffsetDateTime.now(ZoneOffset.UTC));
        documentRepository.saveAndFlush(trashed);

        // A trashed page still blocks deletion, so the summary must report it.
        assertThat(documentRepository.countBySpace_Id(space.getId())).isEqualTo(2);
        assertThat(documentRepository.countBySpaceIds(List.of(space.getId())))
                .singleElement()
                .satisfies(row -> assertThat(((Number) row[1]).longValue()).isEqualTo(2));
    }

    @Test
    void archivedListing_returnsOnlySpacesTheCallerOwns() {
        User owner = userRepository.saveAndFlush(User.builder()
                .email("space-archive-" + UUID.randomUUID() + "@example.com")
                .displayName("Owner")
                .passwordHash("$2a$12$hash")
                .build());
        Workspace workspace = workspaceRepository.saveAndFlush(
                Workspace.builder().name("NextDocs").build());
        OffsetDateTime archivedAt = OffsetDateTime.now(ZoneOffset.UTC);
        Space owned = archivedSpace(workspace, "Owned", archivedAt);
        Space editOnly = archivedSpace(workspace, "Edit only", archivedAt.minusDays(1));
        archivedSpace(workspace, "Unlisted", archivedAt.minusDays(2));

        spaceMemberRepository.saveAndFlush(SpaceMember.builder()
                .space(owned)
                .user(owner)
                .accessLevel(DocumentAccessLevel.OWNER)
                .build());
        spaceMemberRepository.saveAndFlush(SpaceMember.builder()
                .space(editOnly)
                .user(owner)
                .accessLevel(DocumentAccessLevel.EDIT)
                .build());

        List<UUID> restoreIds = spaceRepository.findArchivedOwnedByUser(workspace.getId(), owner.getId()).stream()
                .map(Space::getId)
                .toList();

        assertThat(restoreIds).containsExactly(owned.getId());
    }

    private Space archivedSpace(Workspace workspace, String name, OffsetDateTime archivedAt) {
        return spaceRepository.saveAndFlush(Space.builder()
                .workspace(workspace)
                .name(name)
                .accessMode(SpaceAccessMode.CUSTOM)
                .archivedAt(archivedAt)
                .build());
    }

    @Test
    void activeSpaceListings_followTheCallersPersonalOrderWithUnkeyedLast() {
        User owner = userRepository.saveAndFlush(User.builder()
                .email("space-order-" + UUID.randomUUID() + "@example.com")
                .displayName("Owner")
                .passwordHash("$2a$12$hash")
                .build());
        Workspace workspace = workspaceRepository.saveAndFlush(
                Workspace.builder().name("NextDocs").build());
        Space unkeyed = publicSpace(workspace, "Unkeyed");
        Space first = publicSpace(workspace, "First");
        Space second = publicSpace(workspace, "Second");

        // Personal keys, not creation order: the space created last moves first.
        userSpaceOrderRepository.saveAndFlush(UserSpaceOrder.builder()
                .user(owner)
                .space(second)
                .orderKey("a1")
                .build());
        userSpaceOrderRepository.saveAndFlush(
                UserSpaceOrder.builder().user(owner).space(first).orderKey("a0").build());

        assertThat(spaceRepository.findAllActiveForUser(workspace.getId(), owner.getId()))
                .extracting(Space::getId)
                .containsExactly(first.getId(), second.getId(), unkeyed.getId());
        assertThat(spaceRepository.findAllVisibleToUser(workspace.getId(), owner.getId()))
                .extracting(Space::getId)
                .containsExactly(first.getId(), second.getId(), unkeyed.getId());
    }

    private Space publicSpace(Workspace workspace, String name) {
        return spaceRepository.saveAndFlush(Space.builder()
                .workspace(workspace)
                .name(name)
                .accessMode(SpaceAccessMode.PUBLIC)
                .everyoneAccessLevel(DocumentAccessLevel.VIEW)
                .build());
    }
}
