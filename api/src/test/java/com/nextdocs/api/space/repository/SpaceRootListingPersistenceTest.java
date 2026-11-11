package com.nextdocs.api.space.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.document.entity.AccessGrant;
import com.nextdocs.api.document.entity.AccessGrantEffect;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.repository.AccessGrantRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.repository.SharedDocumentCandidate;
import com.nextdocs.api.document.repository.SharedRootCandidate;
import com.nextdocs.api.space.entity.Space;
import com.nextdocs.api.space.entity.SpaceAccessMode;
import com.nextdocs.api.space.entity.SpaceMember;
import com.nextdocs.api.space.entity.UserSpaceOrder;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.entity.WorkspaceMember;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
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
                .user(owner)
                .space(space)
                .workspace(space == null ? null : space.getWorkspace())
                .title(title)
                .build());
    }

    private Document workspacePage(User owner, Workspace workspace, String title) {
        return documentRepository.saveAndFlush(Document.builder()
                .id(UUID.randomUUID())
                .user(owner)
                .workspace(workspace)
                .title(title)
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

        List<UUID> sharedIds = documentRepository.findSharedRootDocuments(owner.getId()).stream()
                .map(SharedRootCandidate::id)
                .toList();
        assertThat(sharedIds).isEmpty();

        // The space's own listing runs resolve_effective_access, so it is pinned against
        // PostgreSQL in SpacePermissionMigrationPostgresTest; the count is plain SQL.
        assertThat(documentRepository.countBySpace_Id(space.getId())).isEqualTo(1);
    }

    @Test
    void sharedListings_keepSpacePagesAndChildrenOutButReturnDirectShares() {
        User owner = userRepository.saveAndFlush(User.builder()
                .email("space-shared-owner-" + UUID.randomUUID() + "@example.com")
                .displayName("Owner")
                .build());
        User viewer = userRepository.saveAndFlush(User.builder()
                .email("space-shared-viewer-" + UUID.randomUUID() + "@example.com")
                .displayName("Viewer")
                .build());
        Workspace workspace = workspaceRepository.saveAndFlush(
                Workspace.builder().name("NextDocs").build());
        workspaceMemberRepository.saveAndFlush(WorkspaceMember.builder()
                .workspace(workspace)
                .user(viewer)
                .role(WorkspaceRole.MEMBER)
                .build());
        Space space = spaceRepository.saveAndFlush(Space.builder()
                .workspace(workspace)
                .name("Engineering")
                .accessMode(SpaceAccessMode.PUBLIC)
                .everyoneAccessLevel(DocumentAccessLevel.VIEW)
                .build());
        spaceMemberRepository.saveAndFlush(SpaceMember.builder()
                .space(space)
                .user(viewer)
                .accessLevel(DocumentAccessLevel.VIEW)
                .build());

        Document spaceRoot = page(owner, space, "Space Root");
        Document spaceChild = documentRepository.saveAndFlush(Document.builder()
                .id(UUID.randomUUID())
                .user(owner)
                .workspace(workspace)
                .parent(spaceRoot)
                .title("Space Child")
                .build());
        Document directShare = page(owner, null, "Direct Share");
        directShare.setWorkspace(workspace);
        directShare = documentRepository.saveAndFlush(directShare);
        accessGrantRepository.saveAndFlush(AccessGrant.builder()
                .workspace(workspace)
                .document(directShare)
                .user(viewer)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.VIEW)
                .build());

        List<UUID> flatSharedIds = documentRepository.findSharedWithUserId(viewer.getId()).stream()
                .map(SharedDocumentCandidate::id)
                .toList();
        List<UUID> sharedRootIds = documentRepository.findSharedRootDocuments(viewer.getId()).stream()
                .map(SharedRootCandidate::id)
                .toList();

        assertThat(flatSharedIds).containsExactly(directShare.getId());
        assertThat(sharedRootIds).containsExactly(directShare.getId());
        assertThat(flatSharedIds).doesNotContain(spaceRoot.getId(), spaceChild.getId());
    }

    @Test
    @Transactional
    void workspaceMemberOffboarding_removesAllowAndDenyGrantsOnlyFromThatWorkspace() {
        User owner = userRepository.saveAndFlush(User.builder()
                .email("offboard-owner-" + UUID.randomUUID() + "@example.com")
                .displayName("Owner")
                .build());
        User member = userRepository.saveAndFlush(User.builder()
                .email("offboard-member-" + UUID.randomUUID() + "@example.com")
                .displayName("Member")
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
    void flatSharedCandidates_exposeTheNestedParentId() {
        User owner = userRepository.saveAndFlush(User.builder()
                .email("shared-parent-owner-" + UUID.randomUUID() + "@example.com")
                .displayName("Owner")
                .build());
        User viewer = userRepository.saveAndFlush(User.builder()
                .email("shared-parent-viewer-" + UUID.randomUUID() + "@example.com")
                .displayName("Viewer")
                .build());
        Workspace workspace = workspaceRepository.saveAndFlush(
                Workspace.builder().name("NextDocs").build());
        workspaceMemberRepository.saveAndFlush(WorkspaceMember.builder()
                .workspace(workspace)
                .user(viewer)
                .role(WorkspaceRole.MEMBER)
                .build());

        Document parent = workspacePage(owner, workspace, "Parent");
        Document child = documentRepository.saveAndFlush(Document.builder()
                .id(UUID.randomUUID())
                .user(owner)
                .workspace(workspace)
                .parent(parent)
                .title("Child")
                .build());
        accessGrantRepository.saveAndFlush(AccessGrant.builder()
                .workspace(workspace)
                .document(child)
                .user(viewer)
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.VIEW)
                .build());

        List<SharedDocumentCandidate> candidates = documentRepository.findSharedWithUserId(viewer.getId());

        assertThat(candidates).extracting(SharedDocumentCandidate::id).containsExactly(child.getId());
        assertThat(candidates).extracting(SharedDocumentCandidate::parentId).containsExactly(parent.getId());
    }

    @Test
    void spacePageCounts_includePagesInTrash() {
        User owner = userRepository.saveAndFlush(User.builder()
                .email("space-count-" + UUID.randomUUID() + "@example.com")
                .displayName("Owner")
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
