package com.nextdocs.api.document.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.nextdocs.api.PostgresTestSupport;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

/**
 * Golden matrix for the permission contract.
 *
 * <pre>
 * Permission Resolution Scenarios:
 *
 * | Scenario                   | Setup / Context                                  | Resolved    | Rule / Why                                         |
 * |----------------------------|--------------------------------------------------|-------------|----------------------------------------------------|
 * | Standalone page creator    | Doc outside space (space_id is null)             | OWNER       | Creator is implicit owner on standalone pages.     |
 * | Space page creator         | Doc in space, creator has no space membership    | NULL        | In spaces, creator is attribution only.            |
 * | Public space default       | Public space (VIEW), workspace member            | VIEW        | Public space baseline applies to workspace members.|
 * | Space member vs default    | Public space (EDIT), member role set to VIEW     | EDIT        | Highest level wins across space sources.           |
 * | Page grant raises space    | Space baseline (VIEW), page user grant (EDIT)    | EDIT        | Nearest page grant overrides space baseline.       |
 * | Lower grant on child page  | Parent grant (EDIT), child page grant (VIEW)     | VIEW        | Nearest page grant overrides ancestor grant.       |
 * | Page block (NO_ACCESS)     | Parent grant (EDIT), child set to NO_ACCESS      | NO_ACCESS   | Nearest DENY shadows all inherited grants.         |
 * | Grant re-opens below block | Ancestor (NO_ACCESS), child page grant (EDIT)    | EDIT        | Nearer grant re-opens access below a barrier.      |
 * | User grant vs group grant  | Group grant (EDIT) + User grant (VIEW) at page   | EDIT        | Highest level wins across multiple sources.        |
 * | Workspace vs space access  | Space (EDIT) + Page workspace audience (VIEW)    | EDIT        | Highest level wins across multiple sources.        |
 * | User ALLOW vs group DENY   | Group (DENY) + User grant (VIEW) at same page    | VIEW        | Specific user grant survives group deny at page.   |
 * | Public link + page DENY    | Identity (NO_ACCESS) + Live public link (VIEW)   | VIEW        | Broadest wins: public link is independent channel. |
 * | Expired public link        | Child link expired + Parent link active (VIEW)   | VIEW        | Expired link is ignored; ancestor link applies.    |
 * | Archived space             | Space archived, user had EDIT or OWNER           | VIEW        | Archived space caps all positive access at VIEW.   |
 * | Trashed document           | Trashed doc with pre-trash EDIT + live link VIEW | EDIT (Trash)| Trash scope keeps pre-trash identity; link ignored.|
 * </pre>
 *
 * <p>Effective access: Highest level wins across multiple sources (Group, Member, Space,
 * Workspace Audience, Public Link). Inheritance vs override: Nearest scope wins (depth ASC).
 */
class PermissionGoldenMatrixPostgresTest {

    private static Connection sharedConnection;
    private static String schema;
    private static String url;
    private static String username;
    private static String password;

    private Connection connection;
    private UUID workspaceId;
    private UUID ownerId;

    @BeforeAll
    static void setUpAll() throws Exception {
        url = PostgresTestSupport.resolveUrl();
        username = PostgresTestSupport.resolveUsername();
        password = PostgresTestSupport.resolvePassword();

        schema = "pgtest_golden_" + UUID.randomUUID().toString().replace("-", "");
        Flyway.configure()
                .dataSource(url, username, password)
                .schemas(schema)
                .defaultSchema(schema)
                .createSchemas(true)
                .locations("classpath:db/migration")
                .load()
                .migrate();

        sharedConnection = PostgresTestSupport.connect(url, username, password);
    }

    @AfterAll
    static void tearDownAll() throws Exception {
        if (sharedConnection != null && !sharedConnection.isClosed()) {
            try (Statement stmt = sharedConnection.createStatement()) {
                stmt.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
            } finally {
                sharedConnection.close();
            }
        }
    }

    @BeforeEach
    void setUp() throws Exception {
        connection = PostgresTestSupport.connect(url, username, password);
        try (Statement stmt = connection.createStatement()) {
            stmt.execute("SET search_path TO " + schema);
            stmt.execute("TRUNCATE TABLE workspaces, users CASCADE");
        }

        workspaceId = insertWorkspace();
        ownerId = insertMember("OWNER");
    }

    @AfterEach
    void tearDown() throws Exception {
        if (connection != null && !connection.isClosed()) {
            connection.close();
        }
    }

    // ─── Case 1: an OPEN space is a baseline for every workspace member ──────────────

    @Test
    void openSpaceBaseline_appliesToEveryWorkspaceMember() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID outsider = insertUser();
        UUID spaceId = insertSpace("PUBLIC", "VIEW");
        UUID page = insertDoc(ownerId, null, spaceId, null, null, false, false);

        assertThat(resolveAccess(member, page)).isEqualTo("VIEW");
        // user_id is attribution inside a space (V37), so the baseline applies to the creator too.
        assertThat(resolveAccess(ownerId, page)).isEqualTo("VIEW");
        // A PUBLIC space is workspace-public, never internet-public.
        assertThat(resolveAccess(outsider, page)).isNull();
    }

    // ─── Case 1b: public space default vs explicit membership: highest level wins ───

    @Test
    void publicSpaceDefault_highestLevelWinsOverLowerMemberRole() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID spaceId = insertSpace("PUBLIC", "EDIT");
        insertSpaceMember(spaceId, member, "VIEW");
        UUID page = insertDoc(ownerId, null, spaceId, null, null, false, false);

        assertThat(resolveAccess(member, page)).isEqualTo("EDIT");
    }

    @Test
    void publicSpaceEveryoneGrant_doesNotLowerAListedMember() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID spaceId = insertSpace("PUBLIC", "VIEW");
        insertSpaceMember(spaceId, member, "EDIT");
        UUID page = insertDoc(ownerId, null, spaceId, null, null, false, false);

        assertThat(resolveAccess(member, page)).isEqualTo("EDIT");
    }

    // ─── Case 2: an explicit page grant can raise a member above the space ───────────

    @Test
    void pageGrant_raisesAboveOpenSpace() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID other = insertMember("MEMBER");
        UUID spaceId = insertSpace("PUBLIC", "VIEW");
        UUID page = insertDoc(ownerId, null, spaceId, null, null, false, false);
        insertCollaborator(page, member, "EDIT");

        assertThat(resolveAccess(member, page)).isEqualTo("EDIT");
        assertThat(resolveAccess(other, page)).isEqualTo("VIEW");
    }

    // ─── Case 3: an explicit page block can lower a member below the space ───────────

    @Test
    void pageNoAccess_blocksOpenSpace() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID other = insertMember("MEMBER");
        UUID spaceId = insertSpace("PUBLIC", "VIEW");
        UUID page = insertDoc(ownerId, null, spaceId, null, null, false, false);
        insertCollaborator(page, member, "NO_ACCESS");

        assertThat(resolveAccess(member, page)).isEqualTo("NO_ACCESS");
        assertThat(resolveAccess(other, page)).isEqualTo("VIEW");
    }

    // ─── Case 4: the nearest block shadows a positive grant above it ─────────────────

    @Test
    void nearerNoAccess_blocksAncestorGrant() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID root = insertDoc(ownerId, null, null, null, null, false, false);
        UUID child = insertDoc(ownerId, root, null, null, null, false, false);
        insertCollaborator(root, member, "EDIT");
        insertCollaborator(child, member, "NO_ACCESS");

        assertThat(resolveAccess(member, root)).isEqualTo("EDIT");
        assertThat(resolveAccess(member, child)).isEqualTo("NO_ACCESS");
    }

    // ─── Case 5: a nearer positive grant re-opens below a block ──────────────────────

    @Test
    void nearerGrant_reopensBelowNoAccess() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID root = insertDoc(ownerId, null, null, null, null, false, false);
        UUID child = insertDoc(ownerId, root, null, null, null, false, false);
        insertCollaborator(root, member, "NO_ACCESS");
        insertCollaborator(child, member, "EDIT");

        assertThat(resolveAccess(member, root)).isEqualTo("NO_ACCESS");
        assertThat(resolveAccess(member, child)).isEqualTo("EDIT");
    }

    // ─── A page grant can reach a workspace member outside a private space ───────────

    @Test
    void pageGrant_reachesNonMemberOfPrivateSpace() throws SQLException {
        UUID outsider = insertMember("MEMBER");
        UUID spaceId = insertSpace("CUSTOM", "VIEW");
        UUID page = insertDoc(ownerId, null, spaceId, null, null, false, false);
        insertCollaborator(page, outsider, "EDIT");

        assertThat(resolveAccess(outsider, page)).isEqualTo("EDIT");
    }

    // ─── Case 10: the anonymous link channel ─────────────────────────────────────────

    @Test
    void publicLink_grantsAnonymousView() throws SQLException {
        UUID page = insertDoc(ownerId, null, null, "ANYONE_WITH_LINK", "VIEW", false, false);

        assertThat(resolvePublicAccess(page)).isEqualTo("VIEW");
    }

    // ─── Case 11: a signed-in user with no identity grant falls back to the link ─────

    @Test
    void publicLink_grantsSignedInUserWithoutIdentityGrant() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID page = insertDoc(ownerId, null, null, "ANYONE_WITH_LINK", "VIEW", false, false);

        assertThat(resolveAccess(member, page)).isEqualTo("VIEW");
    }

    // ─── Case 12: a block applies to the signed-in identity, not to the link ─────────

    @Test
    void pageNoAccess_doesNotRevokeLinkForSignedInUser() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID page = insertDoc(ownerId, null, null, "ANYONE_WITH_LINK", "VIEW", false, false);
        insertCollaborator(page, member, "NO_ACCESS");

        // A valid link is a separate positive channel, so it keeps the page readable
        // to the signed-in holder even when their identity baseline is denied.
        assertThat(resolveAccess(member, page)).isEqualTo("VIEW");
        assertThat(resolvePublicAccess(page)).isEqualTo("VIEW");
    }

    // ─── Invariant: a space grant is never an anonymous link grant ───────────────────

    @Test
    void spaceGrant_neverLeaksToAnonymousLink() throws SQLException {
        UUID spaceId = insertSpace("PUBLIC", "EDIT");
        UUID page = insertDoc(ownerId, null, spaceId, null, null, false, false);

        assertThat(resolvePublicAccess(page)).isNull();
    }

    // ─── Case 15: archive caps every identity level at VIEW ───────────────────────────

    @Test
    void archivedSpace_capsEditAtView() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID spaceId = insertSpace("CUSTOM", "VIEW");
        insertSpaceMember(spaceId, member, "EDIT");
        UUID page = insertDoc(ownerId, null, spaceId, null, null, false, false);

        assertThat(resolveAccess(member, page)).isEqualTo("EDIT");

        archiveSpace(spaceId);

        assertThat(resolveAccess(member, page)).isEqualTo("VIEW");
    }

    // ─── Case 16: trash is a separate scope that keeps pre-trash grants ──────────────

    @Test
    void trashScope_keepsPreTrashGrant() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID spaceId = insertSpace("CUSTOM", "VIEW");
        insertSpaceMember(spaceId, member, "EDIT");
        UUID page = insertDoc(ownerId, null, spaceId, null, null, false, true);

        assertThat(resolveAccess(member, page)).isNull();
        assertThat(resolveTrashAccess(member, page)).isEqualTo("EDIT");
    }

    // ─── Case 17: an archived space has no trash scope ───────────────────────────────

    @Test
    void archivedSpace_deniesTrashScope() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID spaceId = insertSpace("CUSTOM", "VIEW");
        insertSpaceMember(spaceId, member, "EDIT");
        UUID page = insertDoc(ownerId, null, spaceId, null, null, false, true);

        archiveSpace(spaceId);

        assertThat(resolveTrashAccess(member, page)).isNull();
    }

    // ─── Case 19: workspace administration is not content access ─────────────────────

    @Test
    void workspaceAdmin_hasNoImplicitContentAccess() throws SQLException {
        UUID admin = insertMember("ADMIN");
        UUID page = insertDoc(ownerId, null, null, null, null, false, false);

        assertThat(resolveAccess(admin, page)).isNull();
    }

    // ─── Cases 20-21: creator attribution inside a space vs ownership outside one ────

    @Test
    void pageInSpace_treatsCreatorAsAttributionOnly() throws SQLException {
        UUID spaceId = insertSpace("CUSTOM", "VIEW");
        UUID page = insertDoc(ownerId, null, spaceId, null, null, false, false);

        // The creator is not a space member, so user_id grants nothing inside the space.
        assertThat(resolveAccess(ownerId, page)).isNull();

        insertSpaceMember(spaceId, ownerId, "EDIT");
        assertThat(resolveAccess(ownerId, page)).isEqualTo("EDIT");
    }

    @Test
    void standalonePage_creatorIsImplicitOwner() throws SQLException {
        UUID page = insertDoc(ownerId, null, null, null, null, false, false);
        UUID stranger = insertMember("MEMBER");

        assertThat(resolveAccess(ownerId, page)).isEqualTo("OWNER");
        assertThat(resolveAccess(stranger, page)).isNull();
    }

    // ─── Invariant: one grant wins, and batch resolution agrees with single checks ────

    @Test
    void batchResolution_agreesWithSingleResolution() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID spaceId = insertSpace("PUBLIC", "VIEW");

        UUID baselinePage = insertDoc(ownerId, null, spaceId, null, null, false, false);
        UUID raisedPage = insertDoc(ownerId, null, spaceId, null, null, false, false);
        insertCollaborator(raisedPage, member, "EDIT");
        UUID blockedPage = insertDoc(ownerId, null, spaceId, null, null, false, false);
        insertCollaborator(blockedPage, member, "NO_ACCESS");
        UUID privatePage = insertDoc(ownerId, null, null, null, null, false, false);
        UUID linkPage = insertDoc(ownerId, null, null, "ANYONE_WITH_LINK", "COMMENT", false, false);

        List<UUID> ids = List.of(baselinePage, raisedPage, blockedPage, privatePage, linkPage);
        Map<UUID, String> single = new LinkedHashMap<>();
        for (UUID id : ids) {
            single.put(id, resolveAccess(member, id));
        }

        Map<UUID, String> batch = resolveAccessBatch(member, ids);

        assertThat(batch).isEqualTo(single);
        assertThat(batch.get(baselinePage)).isEqualTo("VIEW");
        assertThat(batch.get(raisedPage)).isEqualTo("EDIT");
        assertThat(batch.get(blockedPage)).isEqualTo("NO_ACCESS");
        assertThat(batch.get(privatePage)).isNull();
        assertThat(batch.get(linkPage)).isEqualTo("COMMENT");
    }

    // ─── Page audience rules and the grant store ─────────────────────────────────────

    @Test
    void pageAudienceNoAccess_blocksInheritedGrantAndExplicitShareReopens() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID spaceId = insertSpace("CUSTOM", "VIEW");
        insertSpaceMember(spaceId, member, "EDIT");
        UUID page = insertDoc(ownerId, null, spaceId, null, null, false, false);

        insertAccessGrant(page, null, null, "SPACE_MEMBERS", "DENY", null);
        assertThat(resolveAccess(member, page)).isEqualTo("NO_ACCESS");

        insertAccessGrant(page, member, null, null, "ALLOW", "EDIT");
        assertThat(resolveAccess(member, page)).isEqualTo("EDIT");
    }

    @Test
    void pageAudienceAllow_replacesTheSpaceBaseline() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID spaceId = insertSpace("CUSTOM", "VIEW");
        insertSpaceMember(spaceId, member, "EDIT");
        UUID page = insertDoc(ownerId, null, spaceId, null, null, false, false);

        insertAccessGrant(page, null, null, "SPACE_MEMBERS", "ALLOW", "VIEW");
        assertThat(resolveAccess(member, page)).isEqualTo("VIEW");

        insertAccessGrant(page, member, null, null, "ALLOW", "EDIT");
        assertThat(resolveAccess(member, page)).isEqualTo("EDIT");
    }

    @Test
    void spaceOwner_pageDenyOverridesInheritedOwnership() throws SQLException {
        UUID spaceId = insertSpace("CUSTOM", "VIEW");
        insertSpaceMember(spaceId, ownerId, "OWNER");
        UUID page = insertDoc(ownerId, null, spaceId, null, null, false, false);
        insertAccessGrant(page, ownerId, null, null, "DENY", null);

        assertThat(resolveAccess(ownerId, page)).isEqualTo("NO_ACCESS");
        assertThat(resolveTrashAccess(ownerId, page)).isEqualTo("NO_ACCESS");

        archiveSpace(spaceId);
        assertThat(resolveAccess(ownerId, page)).isEqualTo("NO_ACCESS");
        assertThat(resolveTrashAccess(ownerId, page)).isNull();
    }

    @Test
    void spaceOwner_childOverrideCanBeChangedAndRemoved() throws SQLException {
        UUID spaceOwner = insertMember("MEMBER");
        UUID spaceId = insertSpace("CUSTOM", "VIEW");
        insertSpaceMember(spaceId, spaceOwner, "OWNER");
        UUID root = insertDoc(ownerId, null, spaceId, null, null, false, false);
        UUID child = insertDoc(ownerId, root, null, null, null, false, false);
        UUID grandchild = insertDoc(ownerId, child, null, null, null, false, false);
        insertCollaborator(child, spaceOwner, "VIEW");

        assertThat(resolveAccess(spaceOwner, root)).isEqualTo("OWNER");
        assertThat(resolveAccess(spaceOwner, child)).isEqualTo("VIEW");
        assertThat(resolveAccess(spaceOwner, grandchild)).isEqualTo("VIEW");
        assertThat(resolveTrashAccess(spaceOwner, child)).isEqualTo("VIEW");

        for (String level : List.of("COMMENT", "EDIT", "VIEW")) {
            jdbc().update(
                            "UPDATE access_grants SET access_level = :level WHERE document_id = :id AND user_id = :userId",
                            new MapSqlParameterSource("id", child)
                                    .addValue("userId", spaceOwner)
                                    .addValue("level", level));
            assertThat(resolveAccess(spaceOwner, child)).isEqualTo(level);
            assertThat(resolveAccess(spaceOwner, grandchild)).isEqualTo(level);
            assertThat(resolveIdentityAccessBatch(spaceOwner, List.of(child, grandchild)))
                    .containsEntry(child, level)
                    .containsEntry(grandchild, level);
        }

        jdbc().update("DELETE FROM access_grants WHERE document_id = :id", new MapSqlParameterSource("id", child));

        assertThat(resolveAccess(spaceOwner, child)).isEqualTo("OWNER");
        assertThat(resolveAccess(spaceOwner, grandchild)).isEqualTo("OWNER");
    }

    @Test
    void groupDenyAtTheSamePage_doesNotBeatAUserAllow() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID groupId = insertGroup("Page group");
        insertGroupMember(groupId, member);
        UUID page = insertDoc(ownerId, null, null, null, null, false, false);

        insertAccessGrant(page, null, groupId, null, "DENY", null);
        assertThat(resolveAccess(member, page)).isEqualTo("NO_ACCESS");

        // The user row is more specific than a group deny at the same page.
        insertCollaborator(page, member, "VIEW");
        assertThat(resolveAccess(member, page)).isEqualTo("VIEW");
    }

    @Test
    void userDenyAtTheSamePage_doesNotBeatAGroupAllow() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID groupId = insertGroup("Page group");
        insertGroupMember(groupId, member);
        UUID page = insertDoc(ownerId, null, null, null, null, false, false);

        // Group EDIT + Direct user NO_ACCESS at same page -> EDIT
        insertAccessGrant(page, null, groupId, null, "ALLOW", "EDIT");
        insertAccessGrant(page, member, null, null, "DENY", null);
        assertThat(resolveAccess(member, page)).isEqualTo("EDIT");

        // Group VIEW + Direct user NO_ACCESS at same page -> VIEW
        UUID page2 = insertDoc(ownerId, null, null, null, null, false, false);
        insertAccessGrant(page2, null, groupId, null, "ALLOW", "VIEW");
        insertAccessGrant(page2, member, null, null, "DENY", null);
        assertThat(resolveAccess(member, page2)).isEqualTo("VIEW");

        // Group NO_ACCESS + Direct user NO_ACCESS at same page -> NO_ACCESS
        UUID page3 = insertDoc(ownerId, null, null, null, null, false, false);
        insertAccessGrant(page3, null, groupId, null, "DENY", null);
        insertAccessGrant(page3, member, null, null, "DENY", null);
        assertThat(resolveAccess(member, page3)).isEqualTo("NO_ACCESS");
    }

    @Test
    void userDenyAtChild_blocksAncestorGroupAllow() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID groupId = insertGroup("Parent group");
        insertGroupMember(groupId, member);
        UUID parent = insertDoc(ownerId, null, null, null, null, false, false);
        UUID child = insertDoc(ownerId, parent, null, null, null, false, false);

        insertAccessGrant(parent, null, groupId, null, "ALLOW", "EDIT");
        insertAccessGrant(child, member, null, null, "DENY", null);

        assertThat(resolveAccess(member, parent)).isEqualTo("EDIT");
        assertThat(resolveAccess(member, child)).isEqualTo("NO_ACCESS");
    }

    @Test
    void linkNeverLowersIdentityAndNeverEntersTrash() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID spaceId = insertSpace("CUSTOM", "VIEW");
        insertSpaceMember(spaceId, member, "EDIT");
        UUID page = insertDoc(ownerId, null, spaceId, "ANYONE_WITH_LINK", "VIEW", false, false);

        assertThat(resolveAccess(member, page)).isEqualTo("EDIT");

        UUID trashedLinkPage = insertDoc(ownerId, null, null, "ANYONE_WITH_LINK", "EDIT", false, true);
        assertThat(resolveAccess(member, trashedLinkPage)).isNull();
        assertThat(resolveTrashAccess(member, trashedLinkPage)).isNull();
    }

    @Test
    void identityDenyAndLiveLinkRemainSeparateChannels() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID page = insertDoc(ownerId, null, null, "ANYONE_WITH_LINK", "VIEW", false, false);
        insertCollaborator(page, member, "NO_ACCESS");

        assertThat(resolveIdentityAccess(member, page, "ACTIVE")).isEqualTo("NO_ACCESS");
        assertThat(resolveAccess(member, page)).isEqualTo("VIEW");
    }

    @Test
    void identityAccessBatchDoesNotKeepLinkOnlyReadersInSharedScope() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID page = insertDoc(ownerId, null, null, "ANYONE_WITH_LINK", "VIEW", false, false);

        Map<UUID, String> identityLevels = resolveIdentityAccessBatch(member, List.of(page));

        assertThat(identityLevels).containsKey(page);
        assertThat(identityLevels.get(page)).isNull();
        assertThat(resolveAccess(member, page)).isEqualTo("VIEW");
    }

    // ─── Phase 3: workspace audience is its own positive channel ─────────────────────

    @Test
    void workspaceAudience_appliesToMembersAndOverridesInheritedSpaceAccess() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID outsider = insertUser();
        UUID standalone = insertDoc(ownerId, null, null, null, null, false, false);
        setWorkspaceAccess(standalone, "WORKSPACE_MEMBERS", "VIEW", false);

        assertThat(resolveAccess(member, standalone)).isEqualTo("VIEW");
        assertThat(hasPositiveIdentityGrant(member, standalone)).isTrue();
        // A workspace audience is workspace-members only, never internet-public.
        assertThat(resolveAccess(outsider, standalone)).isNull();
        assertThat(hasPositiveIdentityGrant(outsider, standalone)).isFalse();

        UUID spaceId = insertSpace("CUSTOM", "VIEW");
        insertSpaceMember(spaceId, member, "VIEW");
        UUID inSpace = insertDoc(ownerId, null, spaceId, null, null, false, false);
        setWorkspaceAccess(inSpace, "WORKSPACE_MEMBERS", "EDIT", false);

        // The page's own workspace rule replaces the inherited space baseline.
        assertThat(resolveAccess(member, inSpace)).isEqualTo("EDIT");
    }

    @Test
    void workspaceAudience_isSuppressedByUserDeny() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID page = insertDoc(ownerId, null, null, null, null, false, false);
        setWorkspaceAccess(page, "WORKSPACE_MEMBERS", "EDIT", false);
        insertCollaborator(page, member, "NO_ACCESS");

        assertThat(resolveAccess(member, page)).isEqualTo("NO_ACCESS");
    }

    @Test
    void workspaceBlock_shadowsAncestorGrantAndNearerGrantReopens() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID root = insertDoc(ownerId, null, null, null, null, false, false);
        setWorkspaceAccess(root, "WORKSPACE_MEMBERS", "EDIT", false);
        UUID child = insertDoc(ownerId, root, null, null, null, false, false);
        setWorkspaceAccess(child, "RESTRICTED", "VIEW", true);

        assertThat(resolveAccess(member, root)).isEqualTo("EDIT");
        assertThat(resolveAccess(member, child)).isNull();

        // A nearer workspace grant re-opens below the block.
        setWorkspaceAccess(child, "WORKSPACE_MEMBERS", "COMMENT", false);
        assertThat(resolveAccess(member, child)).isEqualTo("COMMENT");
    }

    @Test
    void workspaceAudience_isNotUsedInTrash() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID page = insertDoc(ownerId, null, null, null, null, false, false);
        setWorkspaceAccess(page, "WORKSPACE_MEMBERS", "EDIT", false);

        // Workspace identity is an active-page channel; trash stays page/space only.
        assertThat(resolveTrashAccess(member, page)).isNull();
    }

    // ─── Phase 3: link expiry ────────────────────────────────────────────────────────

    @Test
    void expiredPublicLink_stopsGrantingAndDoesNotHideAncestorLink() throws SQLException {
        UUID outsider = insertUser();
        UUID root = insertDoc(ownerId, null, null, "ANYONE_WITH_LINK", "VIEW", false, false);
        UUID child = insertDoc(ownerId, root, null, "ANYONE_WITH_LINK", "EDIT", false, false);
        setLinkExpiry(child, Timestamp.from(Instant.now().minusSeconds(60)));

        // The expired child link is neither a grant nor a barrier: the root link applies.
        assertThat(resolvePublicAccess(child)).isEqualTo("VIEW");
        assertThat(resolveAccess(outsider, child)).isEqualTo("VIEW");

        UUID expiredOnly = insertDoc(ownerId, null, null, "ANYONE_WITH_LINK", "EDIT", false, false);
        setLinkExpiry(expiredOnly, Timestamp.from(Instant.now().minusSeconds(60)));
        assertThat(resolvePublicAccess(expiredOnly)).isNull();
        assertThat(resolveAccess(outsider, expiredOnly)).isNull();
    }

    @Test
    void expiredPublicLink_withInheritBlocked_actsAsBarrier() throws SQLException {
        UUID outsider = insertUser();
        UUID root = insertDoc(ownerId, null, null, "ANYONE_WITH_LINK", "VIEW", false, false);
        UUID child = insertDoc(ownerId, root, null, "ANYONE_WITH_LINK", "EDIT", true, false);
        setLinkExpiry(child, Timestamp.from(Instant.now().minusSeconds(60)));

        // Child explicitly blocked inheritance, so expired link does NOT fall back to root's live link.
        assertThat(resolvePublicAccess(child)).isNull();
        assertThat(resolveAccess(outsider, child)).isNull();
    }

    @Test
    void parentLinkView_childRestrictedBlock_shadowsAncestorLink() throws SQLException {
        UUID outsider = insertUser();
        UUID root = insertDoc(ownerId, null, null, "ANYONE_WITH_LINK", "VIEW", false, false);
        UUID child = insertDoc(ownerId, root, null, "RESTRICTED", "VIEW", true, false);

        assertThat(resolvePublicAccess(root)).isEqualTo("VIEW");
        assertThat(resolvePublicAccess(child)).isNull();
        assertThat(resolveAccess(outsider, child)).isNull();
    }

    @Test
    void parentLinkView_childBlock_grandchildLinkEdit_grandchildIsEdit() throws SQLException {
        UUID outsider = insertUser();
        UUID root = insertDoc(ownerId, null, null, "ANYONE_WITH_LINK", "VIEW", false, false);
        UUID child = insertDoc(ownerId, root, null, "RESTRICTED", "VIEW", true, false);
        UUID grandchild = insertDoc(ownerId, child, null, "ANYONE_WITH_LINK", "EDIT", false, false);

        assertThat(resolvePublicAccess(child)).isNull();
        assertThat(resolvePublicAccess(grandchild)).isEqualTo("EDIT");
        assertThat(resolveAccess(outsider, grandchild)).isEqualTo("EDIT");
    }

    @Test
    void childLinkAnyone_withInheritBlocked_liveLinkWins() throws SQLException {
        UUID outsider = insertUser();
        UUID root = insertDoc(ownerId, null, null, "ANYONE_WITH_LINK", "VIEW", false, false);
        UUID child = insertDoc(ownerId, root, null, "ANYONE_WITH_LINK", "COMMENT", true, false);

        assertThat(resolvePublicAccess(child)).isEqualTo("COMMENT");
        assertThat(resolveAccess(outsider, child)).isEqualTo("COMMENT");
    }

    // ─── Phase 4: roster identity gate ──────────────────────────────────────────────

    @Test
    void rosterIdentityGate_countsSpaceAncestorGroupAndOwnerButNotLinkOnly() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID spaceMember = insertMember("MEMBER");
        UUID outsider = insertUser();
        UUID spaceId = insertSpace("PUBLIC", "VIEW");
        UUID spaceRoot = insertDoc(ownerId, null, spaceId, null, null, false, false);
        UUID spaceChild = insertDoc(ownerId, spaceRoot, null, null, null, false, false);
        insertSpaceMember(spaceId, spaceMember, "VIEW");

        assertThat(hasPositiveIdentityGrant(spaceMember, spaceChild)).isTrue();
        assertThat(hasPositiveIdentityGrant(outsider, spaceChild)).isFalse();

        UUID standaloneRoot = insertDoc(ownerId, null, null, null, null, false, false);
        UUID standaloneChild = insertDoc(ownerId, standaloneRoot, null, null, null, false, false);
        insertAccessGrant(standaloneRoot, member, null, null, "ALLOW", "EDIT");

        assertThat(hasPositiveIdentityGrant(member, standaloneChild)).isTrue();
        assertThat(hasPositiveIdentityGrant(ownerId, standaloneChild)).isTrue();

        UUID group = insertGroup("Roster editors");
        UUID groupMember = insertMember("MEMBER");
        insertGroupMember(group, groupMember);
        insertAccessGrant(standaloneRoot, null, group, null, "ALLOW", "EDIT");

        assertThat(hasPositiveIdentityGrant(groupMember, standaloneChild)).isTrue();

        UUID denyOnly = insertMember("MEMBER");
        insertAccessGrant(standaloneChild, denyOnly, null, null, "DENY", null);
        assertThat(hasPositiveIdentityGrant(denyOnly, standaloneChild)).isFalse();

        UUID linkOnly = insertDoc(ownerId, null, null, "ANYONE_WITH_LINK", "VIEW", false, false);
        assertThat(hasPositiveIdentityGrant(outsider, linkOnly)).isFalse();
    }

    @Test
    void spacePageCreatorIsAttributionOnlyForRosterIdentity() throws SQLException {
        UUID creator = insertMember("MEMBER");
        UUID spaceId = insertSpace("CUSTOM", "VIEW");
        UUID spaceRoot = insertDoc(creator, null, spaceId, null, null, false, false);
        UUID child = insertDoc(creator, spaceRoot, null, null, null, false, false);

        assertThat(resolveAccess(creator, child)).isNull();
        assertThat(hasPositiveIdentityGrant(creator, child)).isFalse();
    }

    @Test
    void ancestorAllowAndPageDenyStillQualifyWhenLiveLinkWinsBroadestAccess() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID root = insertDoc(ownerId, null, null, null, null, false, false);
        UUID child = insertDoc(ownerId, root, null, "ANYONE_WITH_LINK", "VIEW", false, false);
        insertAccessGrant(root, member, null, null, "ALLOW", "EDIT");
        insertAccessGrant(child, member, null, null, "DENY", null);

        // The independent link grants access; the inherited identity source still
        // qualifies for the roster gate even though its access is blocked here.
        assertThat(resolveAccess(member, child)).isEqualTo("VIEW");
        assertThat(hasPositiveIdentityGrant(member, child)).isTrue();
    }

    @Test
    void staleSpaceMembershipDoesNotPassIdentityGate() throws SQLException {
        UUID outsider = insertUser();
        UUID spaceId = insertSpace("PUBLIC", "VIEW");
        UUID page = insertDoc(ownerId, null, spaceId, null, null, false, false);
        insertSpaceMember(spaceId, outsider, "VIEW");

        assertThat(resolveAccess(outsider, page)).isNull();
        assertThat(hasPositiveIdentityGrant(outsider, page)).isFalse();
    }

    @Test
    void staleGroupMembershipDoesNotGrantPageAccess() throws SQLException {
        UUID removedMember = insertUser();
        UUID group = insertGroup("Former member group");
        insertGroupMember(group, removedMember);
        UUID page = insertDoc(ownerId, null, null, null, null, false, false);
        insertAccessGrant(page, null, group, null, "ALLOW", "EDIT");

        assertThat(resolveAccess(removedMember, page)).isNull();
        assertThat(hasPositiveIdentityGrant(removedMember, page)).isFalse();
    }

    @Test
    void groupSharedPageMatchesTheSharedListingIdentityPredicate() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID group = insertGroup("Shared listing group");
        insertGroupMember(group, member);
        UUID page = insertDoc(ownerId, null, null, null, null, false, false);
        insertAccessGrant(page, null, group, null, "ALLOW", "VIEW");

        List<UUID> sharedIds = jdbc().queryForList(
                        "SELECT d.id FROM documents d WHERE d.user_id <> :userId AND d.deleted_at IS NULL "
                                + "AND resolve_identity_access(:userId, d.id, 'ACTIVE') IN ('VIEW', 'COMMENT', 'EDIT', 'OWNER')",
                        new MapSqlParameterSource("userId", member),
                        UUID.class);

        assertThat(sharedIds).contains(page);
    }

    @Test
    void removingSpaceMemberDeletesPageAllowsAndDeniesFromTheSpaceTree() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID spaceId = insertSpace("CUSTOM", "VIEW");
        UUID root = insertDoc(ownerId, null, spaceId, null, null, false, false);
        UUID child = insertDoc(ownerId, root, null, null, null, false, false);
        UUID standalone = insertDoc(ownerId, null, null, null, null, false, false);
        insertAccessGrant(root, member, null, null, "ALLOW", "VIEW");
        insertAccessGrant(child, member, null, null, "DENY", null);
        insertAccessGrant(standalone, member, null, null, "ALLOW", "EDIT");

        MapSqlParameterSource params =
                new MapSqlParameterSource().addValue("spaceId", spaceId).addValue("userId", member);
        jdbc().update(AccessGrantRepository.DELETE_USER_GRANTS_IN_SPACE_SQL, params);

        assertThat(countUserGrants(root, member)).isZero();
        assertThat(countUserGrants(child, member)).isZero();
        assertThat(countUserGrants(standalone, member)).isEqualTo(1);
    }

    @Test
    void lowerPageOverride_replacesAncestorGrantAndDeletingItRestoresInheritance() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID root = insertDoc(ownerId, null, null, null, null, false, false);
        UUID child = insertDoc(ownerId, root, null, null, null, false, false);
        UUID grandchild = insertDoc(ownerId, child, null, null, null, false, false);
        insertCollaborator(root, member, "EDIT");
        insertCollaborator(child, member, "VIEW");

        assertThat(resolveAccess(member, root)).isEqualTo("EDIT");
        assertThat(resolveAccess(member, child)).isEqualTo("VIEW");
        assertThat(resolveAccess(member, grandchild)).isEqualTo("VIEW");
        assertThat(resolveIdentityAccessBatch(member, List.of(root, child, grandchild)))
                .containsEntry(root, "EDIT")
                .containsEntry(child, "VIEW")
                .containsEntry(grandchild, "VIEW");
        assertThat(resolveTrashAccess(member, child)).isEqualTo("VIEW");

        jdbc().update("DELETE FROM access_grants WHERE document_id = :id", new MapSqlParameterSource("id", child));

        assertThat(resolveAccess(member, child)).isEqualTo("EDIT");
        assertThat(resolveAccess(member, grandchild)).isEqualTo("EDIT");
    }

    @Test
    void workspaceAudience_highestLevelWinsOverLowerCollaboratorGrant() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID spaceId = insertSpace("PUBLIC", "EDIT");
        insertSpaceMember(spaceId, member, "EDIT");
        UUID page = insertDoc(ownerId, null, spaceId, null, null, false, false);
        setWorkspaceAccess(page, "WORKSPACE_MEMBERS", "EDIT", false);
        insertCollaborator(page, member, "COMMENT");

        assertThat(resolveAccess(member, page)).isEqualTo("EDIT");
        assertThat(resolveTrashAccess(member, page)).isEqualTo("COMMENT");

        jdbc().update("DELETE FROM access_grants WHERE document_id = :id", new MapSqlParameterSource("id", page));

        assertThat(resolveAccess(member, page)).isEqualTo("EDIT");
    }

    @Test
    void lowerPageOverride_replacesAncestorOwnership() throws SQLException {
        UUID childOwner = insertMember("MEMBER");
        UUID root = insertDoc(ownerId, null, null, null, null, false, false);
        UUID child = insertDoc(childOwner, root, null, null, null, false, false);
        insertCollaborator(child, ownerId, "VIEW");

        assertThat(resolveAccess(ownerId, root)).isEqualTo("OWNER");
        assertThat(resolveAccess(ownerId, child)).isEqualTo("VIEW");
        assertThat(resolveAccess(childOwner, child)).isEqualTo("OWNER");
    }

    @Test
    void groupAndAudienceGrant_highestLevelWinsOverLowerUserGrantAtSamePage() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID group = insertGroup("Editors");
        insertGroupMember(group, member);
        UUID spaceId = insertSpace("CUSTOM", "VIEW");
        insertSpaceMember(spaceId, member, "EDIT");
        UUID page = insertDoc(ownerId, null, spaceId, null, null, false, false);
        insertAccessGrant(page, null, group, null, "ALLOW", "EDIT");
        insertAccessGrant(page, null, null, "SPACE_MEMBERS", "ALLOW", "EDIT");
        insertCollaborator(page, member, "VIEW");

        assertThat(resolveAccess(member, page)).isEqualTo("EDIT");
    }

    @Test
    void nearerAudienceOverride_replacesStrongerAncestorUserGrant() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID spaceId = insertSpace("CUSTOM", "VIEW");
        insertSpaceMember(spaceId, member, "EDIT");
        UUID root = insertDoc(ownerId, null, spaceId, null, null, false, false);
        UUID child = insertDoc(ownerId, root, null, null, null, false, false);
        insertCollaborator(root, member, "EDIT");
        insertAccessGrant(child, null, null, "SPACE_MEMBERS", "ALLOW", "VIEW");

        assertThat(resolveAccess(member, child)).isEqualTo("VIEW");
    }

    @Test
    void spaceMemberAccess_isNotLoweredByWorkspaceAudienceViewRule() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID spaceId = insertSpace("CUSTOM", "VIEW");
        insertSpaceMember(spaceId, member, "EDIT");
        UUID page = insertDoc(ownerId, null, spaceId, null, null, false, false);
        setWorkspaceAccess(page, "WORKSPACE_MEMBERS", "VIEW", false);

        assertThat(resolveAccess(member, page)).isEqualTo("EDIT");
    }

    @Test
    void publicLink_combinesWithResolvedOverrideNotTheStrongerAncestor() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID root = insertDoc(ownerId, null, null, null, null, false, false);
        UUID child = insertDoc(ownerId, root, null, "ANYONE_WITH_LINK", "COMMENT", false, false);
        insertCollaborator(root, member, "EDIT");
        insertCollaborator(child, member, "VIEW");

        assertThat(resolveIdentityAccess(member, child, "ACTIVE")).isEqualTo("VIEW");
        assertThat(resolveAccess(member, child)).isEqualTo("COMMENT");
        assertThat(resolveTrashAccess(member, child)).isEqualTo("VIEW");
        assertThat(resolveAccessBatch(member, List.of(root, child)))
                .containsEntry(root, "EDIT")
                .containsEntry(child, "COMMENT");
    }

    @Test
    void lowerPublicLink_doesNotLowerTheUserOverride() throws SQLException {
        UUID member = insertMember("MEMBER");
        UUID root = insertDoc(ownerId, null, null, null, null, false, false);
        UUID child = insertDoc(ownerId, root, null, "ANYONE_WITH_LINK", "VIEW", false, false);
        insertCollaborator(root, member, "OWNER");
        insertCollaborator(child, member, "EDIT");

        assertThat(resolveIdentityAccess(member, child, "ACTIVE")).isEqualTo("EDIT");
        assertThat(resolveAccess(member, child)).isEqualTo("EDIT");
    }

    // ─── Fixtures ────────────────────────────────────────────────────────────────────

    private UUID insertWorkspace() throws SQLException {
        UUID id = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, 'NextDocs', now(), now())")) {
            stmt.setObject(1, id);
            stmt.executeUpdate();
        }
        return id;
    }

    private UUID insertUser() throws SQLException {
        UUID id = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) "
                        + "VALUES (?, ?, 'hash', 'Test User', now(), now())")) {
            stmt.setObject(1, id);
            stmt.setString(2, "pgtest-" + id + "@example.com");
            stmt.executeUpdate();
        }
        return id;
    }

    private UUID insertMember(String role) throws SQLException {
        UUID id = insertUser();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, now())")) {
            stmt.setObject(1, workspaceId);
            stmt.setObject(2, id);
            stmt.setString(3, role);
            stmt.executeUpdate();
        }
        return id;
    }

    private UUID insertSpace(String accessMode, String everyoneLevel) throws SQLException {
        UUID id = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO spaces (id, workspace_id, name, access_mode, everyone_access_level, created_at, updated_at) "
                        + "VALUES (?, ?, 'Engineering', ?, ?, now(), now())")) {
            stmt.setObject(1, id);
            stmt.setObject(2, workspaceId);
            stmt.setString(3, accessMode);
            stmt.setString(4, everyoneLevel);
            stmt.executeUpdate();
        }
        return id;
    }

    private void insertSpaceMember(UUID spaceId, UUID userId, String accessLevel) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO space_members (space_id, user_id, access_level, created_at, updated_at) "
                        + "VALUES (?, ?, ?, now(), now())")) {
            stmt.setObject(1, spaceId);
            stmt.setObject(2, userId);
            stmt.setString(3, accessLevel);
            stmt.executeUpdate();
        }
    }

    private UUID insertDoc(
            UUID creatorId,
            UUID parentId,
            UUID spaceId,
            String linkMode,
            String linkLevel,
            boolean linkBlocked,
            boolean trashed)
            throws SQLException {
        UUID id = UUID.randomUUID();
        String sql = "INSERT INTO documents (id, user_id, workspace_id, parent_id, space_id, title, "
                + "general_access_mode, link_access_level, link_inherit_blocked, sibling_order_key, deleted_at, "
                + "created_at, updated_at) "
                + "VALUES (?, ?, (SELECT workspace_id FROM workspace_members ORDER BY created_at LIMIT 1), "
                + "?, ?, ?, ?, ?, ?, ?, ?, now(), now())";
        try (PreparedStatement stmt = connection.prepareStatement(sql)) {
            stmt.setObject(1, id);
            stmt.setObject(2, creatorId);
            stmt.setObject(3, parentId);
            stmt.setObject(4, spaceId);
            stmt.setString(5, "Page " + id);
            stmt.setString(6, linkMode == null ? "RESTRICTED" : linkMode);
            stmt.setString(7, linkLevel == null ? "VIEW" : linkLevel);
            stmt.setBoolean(8, linkBlocked);
            // Space roots need a shared key (V28); child keys only need to be non-null.
            stmt.setString(
                    9,
                    parentId != null || spaceId != null
                            ? "a" + id.toString().replace("-", "").substring(0, 12)
                            : null);
            stmt.setTimestamp(10, trashed ? Timestamp.from(Instant.now()) : null);
            stmt.executeUpdate();
        }
        return id;
    }

    private void setWorkspaceAccess(UUID documentId, String mode, String level, boolean blocked) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "UPDATE documents SET workspace_access_mode = ?, workspace_access_level = ?, "
                        + "workspace_inherit_blocked = ? WHERE id = ?")) {
            stmt.setString(1, mode);
            stmt.setString(2, level);
            stmt.setBoolean(3, blocked);
            stmt.setObject(4, documentId);
            stmt.executeUpdate();
        }
    }

    private void setLinkExpiry(UUID documentId, Timestamp expiresAt) throws SQLException {
        try (PreparedStatement stmt =
                connection.prepareStatement("UPDATE documents SET link_expires_at = ? WHERE id = ?")) {
            stmt.setTimestamp(1, expiresAt);
            stmt.setObject(2, documentId);
            stmt.executeUpdate();
        }
    }

    private UUID insertGroup(String name) throws SQLException {
        UUID id = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO workspace_groups (id, workspace_id, name, created_at, updated_at) "
                        + "VALUES (?, ?, ?, now(), now())")) {
            stmt.setObject(1, id);
            stmt.setObject(2, workspaceId);
            stmt.setString(3, name + " " + id);
            stmt.executeUpdate();
        }
        return id;
    }

    private void insertGroupMember(UUID groupId, UUID userId) throws SQLException {
        try (PreparedStatement stmt =
                connection.prepareStatement("INSERT INTO workspace_group_members (group_id, user_id) VALUES (?, ?)")) {
            stmt.setObject(1, groupId);
            stmt.setObject(2, userId);
            stmt.executeUpdate();
        }
    }

    private void insertAccessGrant(
            UUID documentId, UUID userId, UUID groupId, String audience, String effect, String accessLevel)
            throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO access_grants (workspace_id, document_id, user_id, group_id, audience, effect, "
                        + "access_level, created_at, updated_at) "
                        + "VALUES ((SELECT workspace_id FROM documents WHERE id = ?), ?, ?, ?, ?, ?, ?, now(), now())")) {
            stmt.setObject(1, documentId);
            stmt.setObject(2, documentId);
            stmt.setObject(3, userId);
            stmt.setObject(4, groupId);
            stmt.setString(5, audience);
            stmt.setString(6, effect);
            stmt.setString(7, accessLevel);
            stmt.executeUpdate();
        }
    }

    private void insertCollaborator(UUID documentId, UUID userId, String accessLevel) throws SQLException {
        if ("NO_ACCESS".equals(accessLevel)) {
            insertAccessGrant(documentId, userId, null, null, "DENY", null);
        } else {
            insertAccessGrant(documentId, userId, null, null, "ALLOW", accessLevel);
        }
    }

    private void archiveSpace(UUID spaceId) throws SQLException {
        try (PreparedStatement stmt =
                connection.prepareStatement("UPDATE spaces SET archived_at = now() WHERE id = ?")) {
            stmt.setObject(1, spaceId);
            stmt.executeUpdate();
        }
    }

    private String resolveAccess(UUID userId, UUID documentId) throws SQLException {
        return scalar("SELECT resolve_effective_access(?, ?)", userId, documentId);
    }

    private String resolveIdentityAccess(UUID userId, UUID documentId, String scope) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement("SELECT resolve_identity_access(?, ?, ?)"); ) {
            stmt.setObject(1, userId);
            stmt.setObject(2, documentId);
            stmt.setString(3, scope);
            try (ResultSet rs = stmt.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        }
    }

    private String resolvePublicAccess(UUID documentId) throws SQLException {
        return scalarOne("SELECT resolve_public_access(?)", documentId);
    }

    private String resolveTrashAccess(UUID userId, UUID documentId) throws SQLException {
        return scalar("SELECT resolve_trash_access(?, ?)", userId, documentId);
    }

    private boolean hasPositiveIdentityGrant(UUID userId, UUID documentId) {
        MapSqlParameterSource params =
                new MapSqlParameterSource().addValue("userId", userId).addValue("documentId", documentId);
        return Boolean.TRUE.equals(
                jdbc().queryForObject(AccessGrantRepository.HAS_POSITIVE_IDENTITY_GRANT_SQL, params, Boolean.class));
    }

    private long countUserGrants(UUID documentId, UUID userId) {
        MapSqlParameterSource params =
                new MapSqlParameterSource().addValue("documentId", documentId).addValue("userId", userId);
        return jdbc().queryForObject(
                        "SELECT COUNT(*) FROM access_grants WHERE document_id = :documentId AND user_id = :userId",
                        params,
                        Long.class);
    }

    private Map<UUID, String> resolveAccessBatch(UUID userId, List<UUID> documentIds) {
        String joined = documentIds.stream().map(UUID::toString).collect(Collectors.joining(","));
        MapSqlParameterSource params =
                new MapSqlParameterSource().addValue("userId", userId).addValue("ids", joined);

        Map<UUID, String> result = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbc().queryForList(DocumentRepository.EFFECTIVE_ACCESS_BATCH_SQL, params)) {
            result.put((UUID) row.get("document_id"), (String) row.get("access_level"));
        }
        return result;
    }

    private Map<UUID, String> resolveIdentityAccessBatch(UUID userId, List<UUID> documentIds) {
        String joined = documentIds.stream().map(UUID::toString).collect(Collectors.joining(","));
        MapSqlParameterSource params =
                new MapSqlParameterSource().addValue("userId", userId).addValue("ids", joined);

        Map<UUID, String> result = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbc().queryForList(DocumentRepository.IDENTITY_ACCESS_BATCH_SQL, params)) {
            result.put((UUID) row.get("document_id"), (String) row.get("access_level"));
        }
        return result;
    }

    private String scalar(String sql, UUID first, UUID second) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(sql)) {
            stmt.setObject(1, first);
            stmt.setObject(2, second);
            try (ResultSet rs = stmt.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        }
    }

    private String scalarOne(String sql, UUID argument) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(sql)) {
            stmt.setObject(1, argument);
            try (ResultSet rs = stmt.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        }
    }

    private NamedParameterJdbcTemplate jdbc() {
        return new NamedParameterJdbcTemplate(new SingleConnectionDataSource(connection, true));
    }
}
