package com.nextdocs.api.document.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.nextdocs.api.PostgresTestSupport;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

/**
 * The flat listing's readable count against real PostgreSQL.
 *
 * <p>Effective access lives in {@code resolve_effective_access}, which the H2 suite cannot
 * execute. This pins the rule the listing relies on: a candidate shadowed by a page DENY is
 * not readable and must not count. The test runs the production predicate.
 */
class ReachableListingCountPostgresTest {

    private Connection connection;
    private String schema;
    private String url;
    private String username;
    private String password;

    @BeforeEach
    void setUp() throws Exception {
        url = PostgresTestSupport.resolveUrl();
        username = PostgresTestSupport.resolveUsername();
        password = PostgresTestSupport.resolvePassword();
        connection = PostgresTestSupport.connect(url, username, password);
        schema = "pgtest_" + UUID.randomUUID().toString().replace("-", "");
        Flyway.configure()
                .dataSource(url, username, password)
                .schemas(schema)
                .defaultSchema(schema)
                .createSchemas(true)
                .locations("classpath:db/migration")
                .load()
                .migrate();
        try (Statement stmt = connection.createStatement()) {
            stmt.execute("SET search_path TO " + schema);
        }
    }

    @AfterEach
    void tearDown() throws Exception {
        if (connection == null || connection.isClosed()) {
            return;
        }
        try (Statement stmt = connection.createStatement()) {
            stmt.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        } finally {
            connection.close();
        }
    }

    @Test
    void readableCountExcludesCandidatesShadowedByAPageDeny() throws SQLException {
        UUID owner = insertUser();
        UUID viewer = insertUser();
        UUID workspaceId = insertWorkspaceAndMember(owner);
        insertWorkspaceMember(workspaceId, viewer);

        UUID directRoot = insertDoc(owner, workspaceId, "RESTRICTED", "Direct");
        insertGrant(workspaceId, directRoot, viewer, "ALLOW", "VIEW");

        UUID audienceRoot = insertDoc(owner, workspaceId, "WORKSPACE_MEMBERS", "Audience");

        UUID audienceBlocked = insertDoc(owner, workspaceId, "WORKSPACE_MEMBERS", "Audience blocked");
        // NO_ACCESS is a DENY with a null level; the resolver coalesces the nearest page
        // rule to NO_ACCESS.
        insertGrant(workspaceId, audienceBlocked, viewer, "DENY", null);

        assertThat(queryIds("SELECT d.id" + DocumentRepository.REACHABLE_LISTING_FROM_SQL, viewer))
                .containsExactlyInAnyOrder(directRoot, audienceRoot);
        Long count = jdbc().queryForObject(
                        "SELECT count(*)" + DocumentRepository.REACHABLE_LISTING_FROM_SQL,
                        Map.of("userId", viewer),
                        Long.class);
        assertThat(count).isEqualTo(2L);

        // The paged form: one readable row per window and the same order the repository
        // asks for (updated_at DESC, created_at DESC, id ASC).
        String pagedSql = "SELECT d.id" + DocumentRepository.REACHABLE_LISTING_FROM_SQL
                + " ORDER BY updated_at DESC, created_at DESC, id ASC LIMIT 1 OFFSET ";
        assertThat(queryIds(pagedSql + "0", viewer)).hasSize(1);
        UUID firstPage = queryIds(pagedSql + "0", viewer).get(0);
        UUID secondPage = queryIds(pagedSql + "1", viewer).get(0);
        assertThat(List.of(firstPage, secondPage)).containsExactlyInAnyOrder(directRoot, audienceRoot);
        assertThat(queryIds(pagedSql + "2", viewer)).isEmpty();
    }

    @Test
    void everyMembershipChannelProducesACandidate() throws SQLException {
        UUID owner = insertUser();
        UUID viewer = insertUser();
        UUID workspaceId = insertWorkspaceAndMember(owner);
        insertWorkspaceMember(workspaceId, viewer);

        // Group grant: the group belongs to the page's workspace.
        UUID groupDoc = insertDoc(owner, workspaceId, "RESTRICTED", "Group");
        insertGroupGrant(workspaceId, groupDoc, viewer, "EDIT");

        // A member of the space sees its page even without a page-level channel.
        UUID spaceDoc = insertDoc(owner, workspaceId, "RESTRICTED", "Space");
        insertSpaceMember(workspaceId, spaceDoc, viewer);

        assertThat(queryIds("SELECT d.id" + DocumentRepository.REACHABLE_LISTING_FROM_SQL, viewer))
                .containsExactlyInAnyOrder(groupDoc, spaceDoc);
    }

    @Test
    void readableChildrenInheritedFromGrantedParentsAreIncludedAndDeniedChildrenExcluded() throws SQLException {
        UUID owner = insertUser();
        UUID viewer = insertUser();
        UUID workspaceId = insertWorkspaceAndMember(owner);
        insertWorkspaceMember(workspaceId, viewer);

        UUID grantedParent = insertDoc(owner, workspaceId, "RESTRICTED", "Parent");
        insertGrant(workspaceId, grantedParent, viewer, "ALLOW", "VIEW");

        UUID readableChild = insertChildDoc(owner, workspaceId, grantedParent, "Child", "a0");
        UUID deniedChild = insertChildDoc(owner, workspaceId, grantedParent, "Denied Child", "a1");
        insertGrant(workspaceId, deniedChild, viewer, "DENY", null);

        assertThat(queryIds("SELECT d.id" + DocumentRepository.REACHABLE_LISTING_FROM_SQL, viewer))
                .containsExactlyInAnyOrder(grantedParent, readableChild);
        Long count = jdbc().queryForObject(
                        "SELECT count(*)" + DocumentRepository.REACHABLE_LISTING_FROM_SQL,
                        Map.of("userId", viewer),
                        Long.class);
        assertThat(count).isEqualTo(2L);
    }

    private List<UUID> queryIds(String sql, UUID userId) {
        return jdbc().queryForList(sql, Map.of("userId", userId), UUID.class);
    }

    private NamedParameterJdbcTemplate jdbc() {
        return new NamedParameterJdbcTemplate(new SingleConnectionDataSource(connection, true));
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

    private UUID insertWorkspaceAndMember(UUID userId) throws SQLException {
        UUID workspaceId = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, 'NextDocs', now(), now())")) {
            stmt.setObject(1, workspaceId);
            stmt.executeUpdate();
        }
        insertWorkspaceMember(workspaceId, userId);
        return workspaceId;
    }

    private void insertWorkspaceMember(UUID workspaceId, UUID userId) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'MEMBER', now())")) {
            stmt.setObject(1, workspaceId);
            stmt.setObject(2, userId);
            stmt.executeUpdate();
        }
    }

    private void insertGrant(UUID workspaceId, UUID documentId, UUID userId, String effect, String accessLevel)
            throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO access_grants (workspace_id, document_id, user_id, effect, access_level) "
                        + "VALUES (?, ?, ?, ?, ?)")) {
            stmt.setObject(1, workspaceId);
            stmt.setObject(2, documentId);
            stmt.setObject(3, userId);
            stmt.setString(4, effect);
            stmt.setString(5, accessLevel);
            stmt.executeUpdate();
        }
    }

    private void insertGroupGrant(UUID workspaceId, UUID documentId, UUID userId, String accessLevel)
            throws SQLException {
        UUID groupId = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO workspace_groups (id, workspace_id, name, created_at, updated_at) "
                        + "VALUES (?, ?, ?, now(), now())")) {
            stmt.setObject(1, groupId);
            stmt.setObject(2, workspaceId);
            stmt.setString(3, "group-" + groupId);
            stmt.executeUpdate();
        }
        try (PreparedStatement stmt =
                connection.prepareStatement("INSERT INTO workspace_group_members (group_id, user_id) VALUES (?, ?)")) {
            stmt.setObject(1, groupId);
            stmt.setObject(2, userId);
            stmt.executeUpdate();
        }
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO access_grants (workspace_id, document_id, group_id, effect, access_level) "
                        + "VALUES (?, ?, ?, 'ALLOW', ?)")) {
            stmt.setObject(1, workspaceId);
            stmt.setObject(2, documentId);
            stmt.setObject(3, groupId);
            stmt.setString(4, accessLevel);
            stmt.executeUpdate();
        }
    }

    private void insertSpaceMember(UUID workspaceId, UUID documentId, UUID userId) throws SQLException {
        UUID spaceId = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO spaces (id, workspace_id, name, access_mode) VALUES (?, ?, ?, 'CUSTOM')")) {
            stmt.setObject(1, spaceId);
            stmt.setObject(2, workspaceId);
            stmt.setString(3, "space-" + spaceId);
            stmt.executeUpdate();
        }
        try (PreparedStatement stmt = connection.prepareStatement(
                "UPDATE documents SET space_id = ?, sibling_order_key = 'a0' WHERE id = ?")) {
            stmt.setObject(1, spaceId);
            stmt.setObject(2, documentId);
            stmt.executeUpdate();
        }
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO space_members (space_id, user_id, access_level) VALUES (?, ?, 'VIEW')")) {
            stmt.setObject(1, spaceId);
            stmt.setObject(2, userId);
            stmt.executeUpdate();
        }
    }

    private UUID insertDoc(UUID ownerId, UUID workspaceId, String workspaceAccessMode, String title)
            throws SQLException {
        UUID id = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO documents (id, created_by, workspace_id, title, workspace_access_mode, "
                        + "general_access_mode, link_access_level, created_at, updated_at) "
                        + "VALUES (?, ?, ?, ?, ?, 'RESTRICTED', 'VIEW', now(), now())")) {
            stmt.setObject(1, id);
            stmt.setObject(2, ownerId);
            stmt.setObject(3, workspaceId);
            stmt.setString(4, title);
            stmt.setString(5, workspaceAccessMode);
            stmt.executeUpdate();
        }
        // A standalone root's creator owns it through a real grant row.
        insertGrant(workspaceId, id, ownerId, "ALLOW", "OWNER");
        return id;
    }

    private UUID insertChildDoc(UUID ownerId, UUID workspaceId, UUID parentId, String title, String siblingOrderKey)
            throws SQLException {
        UUID id = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO documents (id, created_by, workspace_id, parent_id, sibling_order_key, title, "
                        + "workspace_access_mode, general_access_mode, link_access_level, created_at, updated_at) "
                        + "VALUES (?, ?, ?, ?, ?, ?, 'RESTRICTED', 'RESTRICTED', 'VIEW', now(), now())")) {
            stmt.setObject(1, id);
            stmt.setObject(2, ownerId);
            stmt.setObject(3, workspaceId);
            stmt.setObject(4, parentId);
            stmt.setString(5, siblingOrderKey);
            stmt.setString(6, title);
            stmt.executeUpdate();
        }
        return id;
    }
}
