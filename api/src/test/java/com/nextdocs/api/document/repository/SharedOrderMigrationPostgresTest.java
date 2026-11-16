package com.nextdocs.api.document.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.nextdocs.api.PostgresTestSupport;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * V44 against real PostgreSQL.
 *
 * <p>The main suite builds its schema from the entities with Flyway disabled, so this is
 * the only place the backfill executes. It matters more than most migrations: V44 copies
 * order rows into a second table and then deletes every collaborator row from the first.
 * A predicate that under-matches loses a viewer's Shared position; one that over-matches
 * gives a page a Shared position it never had, and there is nothing to repair it.
 */
class SharedOrderMigrationPostgresTest {

    private static final String PRIVATE_ORDERS = "user_document_orders";
    private static final String SHARED_ORDERS = "user_shared_document_orders";

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
        migrateTo("43");
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
    void movesAudienceAndCollaboratorRowsAndKeepsOwnerPrivatePositions() throws Exception {
        UUID owner = insertUser();
        UUID collaborator = insertUser();
        // A second member exists so V44's workspace branch is exercised through real
        // membership, not merely through a column value.
        UUID workspace = insertWorkspaceAndMembers(owner, collaborator);
        UUID space = insertSpace(workspace);

        UUID privateRoot = UUID.randomUUID();
        UUID workspaceSharedRoot = UUID.randomUUID();
        UUID spaceRoot = UUID.randomUUID();
        UUID grantedRoot = UUID.randomUUID();
        UUID nestedGranted = UUID.randomUUID();
        UUID nestedPrivate = UUID.randomUUID();

        insertDoc(privateRoot, owner, workspace, null, null, "RESTRICTED", "a1");
        insertDoc(workspaceSharedRoot, owner, workspace, null, null, "WORKSPACE_MEMBERS", "a2");
        insertDoc(spaceRoot, owner, workspace, null, space, "RESTRICTED", "a3");
        insertDoc(grantedRoot, owner, workspace, null, null, "RESTRICTED", "a4");
        insertDoc(nestedGranted, owner, workspace, privateRoot, null, "RESTRICTED", "a5");
        insertDoc(nestedPrivate, owner, workspace, privateRoot, null, "RESTRICTED", "a6");

        insertGrant(workspace, grantedRoot, collaborator);
        insertGrant(workspace, nestedGranted, collaborator);

        insertOrder(PRIVATE_ORDERS, owner, privateRoot, "a1");
        insertOrder(PRIVATE_ORDERS, owner, workspaceSharedRoot, "a2");
        insertOrder(PRIVATE_ORDERS, owner, spaceRoot, "a3");
        insertOrder(PRIVATE_ORDERS, owner, grantedRoot, "a4");
        insertOrder(PRIVATE_ORDERS, owner, nestedGranted, "a5");
        insertOrder(PRIVATE_ORDERS, owner, nestedPrivate, "a6");
        insertOrder(PRIVATE_ORDERS, collaborator, workspaceSharedRoot, "b1");
        insertOrder(PRIVATE_ORDERS, collaborator, spaceRoot, "b2");
        insertOrder(PRIVATE_ORDERS, collaborator, grantedRoot, "b3");
        insertOrder(PRIVATE_ORDERS, collaborator, nestedGranted, "b4");

        migrateFurther();

        // The private table is the caller's own navigation only: every collaborator row
        // is gone, while every owner row survives for an unshare or a member leave.
        assertThat(orderKeys(PRIVATE_ORDERS, collaborator)).isEmpty();
        assertThat(orderKeys(PRIVATE_ORDERS, owner)).containsExactlyInAnyOrder("a1", "a2", "a3", "a4", "a5", "a6");

        // The owner gains a Shared position for every page that now has an audience or a
        // space home. A nested page with a grant qualifies even though the owner's own
        // listing still shows it under its parent.
        assertThat(orderKeys(SHARED_ORDERS, owner)).containsExactlyInAnyOrder("a2", "a3", "a4", "a5");
        assertThat(orderKey(SHARED_ORDERS, owner, privateRoot)).isNull();
        assertThat(orderKey(SHARED_ORDERS, owner, nestedPrivate)).isNull();
        // Keys are copied verbatim, so the restored section keeps its order.
        assertThat(orderKey(SHARED_ORDERS, owner, spaceRoot)).isEqualTo("a3");
        assertThat(orderKey(SHARED_ORDERS, owner, nestedGranted)).isEqualTo("a5");

        // Collaborator rows move wholesale, including a space root they only reach by
        // grant, and keep their keys.
        assertThat(orderKeys(SHARED_ORDERS, collaborator)).containsExactlyInAnyOrder("b1", "b2", "b3", "b4");
        assertThat(countRows(SHARED_ORDERS)).isEqualTo(8);
    }

    @Test
    void copiesTrashedRowsAndCountsAGroupGrantAsAnAudience() throws Exception {
        UUID owner = insertUser();
        UUID collaborator = insertUser();
        UUID workspace = insertWorkspaceAndMembers(owner, collaborator);
        UUID groupId = insertGroup(workspace);

        UUID trashedAudienceRoot = UUID.randomUUID();
        UUID groupAudienceRoot = UUID.randomUUID();
        UUID trashedPrivateRoot = UUID.randomUUID();

        insertDoc(trashedAudienceRoot, owner, workspace, null, null, "WORKSPACE_MEMBERS", "a1", true);
        insertDoc(groupAudienceRoot, owner, workspace, null, null, "RESTRICTED", "a2");
        insertDoc(trashedPrivateRoot, owner, workspace, null, null, "RESTRICTED", "a3", true);

        insertGroupGrant(workspace, groupAudienceRoot, groupId);

        insertOrder(PRIVATE_ORDERS, owner, trashedAudienceRoot, "a1");
        insertOrder(PRIVATE_ORDERS, owner, groupAudienceRoot, "a2");
        insertOrder(PRIVATE_ORDERS, owner, trashedPrivateRoot, "a3");
        insertOrder(PRIVATE_ORDERS, collaborator, trashedAudienceRoot, "b1");

        migrateFurther();

        // A trashed page still occupies its keys until purge, so its rows have to keep them;
        // dropping them here would free a key the page reclaims on restore.
        assertThat(orderKeys(SHARED_ORDERS, owner)).containsExactlyInAnyOrder("a1", "a2");
        assertThat(orderKey(SHARED_ORDERS, owner, trashedPrivateRoot)).isNull();
        // A group grant is an audience for the owner even though the owner is not a member.
        assertThat(orderKey(SHARED_ORDERS, owner, groupAudienceRoot)).isEqualTo("a2");
        // The collaborator row moves wholesale, trashed page included.
        assertThat(orderKeys(SHARED_ORDERS, collaborator)).containsExactly("b1");
        assertThat(orderKeys(PRIVATE_ORDERS, collaborator)).isEmpty();
    }

    /** Builds a throwaway schema stopped at a target version and uses it. */
    private void migrateTo(String target) throws SQLException {
        if (schema != null) {
            try (Statement stmt = connection.createStatement()) {
                stmt.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
            }
        }
        schema = "pgtest_" + UUID.randomUUID().toString().replace("-", "");
        Flyway.configure()
                .dataSource(url, username, password)
                .schemas(schema)
                .defaultSchema(schema)
                .createSchemas(true)
                .locations("classpath:db/migration")
                .target(MigrationVersion.fromVersion(target))
                .load()
                .migrate();
        try (Statement stmt = connection.createStatement()) {
            stmt.execute("SET search_path TO " + schema);
        }
    }

    /** Applies the remaining migrations to the schema currently in use. */
    private void migrateFurther() {
        Flyway.configure()
                .dataSource(url, username, password)
                .schemas(schema)
                .defaultSchema(schema)
                .createSchemas(false)
                .locations("classpath:db/migration")
                .load()
                .migrate();
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

    private UUID insertWorkspaceAndMembers(UUID first, UUID second) throws SQLException {
        UUID workspaceId = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, 'NextDocs', now(), now())")) {
            stmt.setObject(1, workspaceId);
            stmt.executeUpdate();
        }
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'MEMBER', now())")) {
            stmt.setObject(1, workspaceId);
            stmt.setObject(2, first);
            stmt.executeUpdate();
        }
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'MEMBER', now())")) {
            stmt.setObject(1, workspaceId);
            stmt.setObject(2, second);
            stmt.executeUpdate();
        }
        return workspaceId;
    }

    private UUID insertSpace(UUID workspaceId) throws SQLException {
        UUID id = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO spaces (id, workspace_id, name, access_mode, everyone_access_level, "
                        + "created_at, updated_at) VALUES (?, ?, 'Design', 'CUSTOM', 'VIEW', now(), now())")) {
            stmt.setObject(1, id);
            stmt.setObject(2, workspaceId);
            stmt.executeUpdate();
        }
        return id;
    }

    private void insertDoc(
            UUID id,
            UUID ownerId,
            UUID workspaceId,
            UUID parentId,
            UUID spaceId,
            String workspaceAccessMode,
            String siblingOrderKey)
            throws SQLException {
        insertDoc(id, ownerId, workspaceId, parentId, spaceId, workspaceAccessMode, siblingOrderKey, false);
    }

    private void insertDoc(
            UUID id,
            UUID ownerId,
            UUID workspaceId,
            UUID parentId,
            UUID spaceId,
            String workspaceAccessMode,
            String siblingOrderKey,
            boolean trashed)
            throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO documents (id, user_id, workspace_id, parent_id, space_id, title, "
                        + "general_access_mode, link_access_level, workspace_access_mode, workspace_access_level, "
                        + "sibling_order_key, deleted_at, created_at, updated_at) "
                        + "VALUES (?, ?, ?, ?, ?, ?, 'RESTRICTED', 'VIEW', ?, 'VIEW', ?, "
                        + (trashed ? "now()" : "NULL") + ", now(), now())")) {
            stmt.setObject(1, id);
            stmt.setObject(2, ownerId);
            stmt.setObject(3, workspaceId);
            stmt.setObject(4, parentId);
            stmt.setObject(5, spaceId);
            stmt.setString(6, "Page " + id);
            stmt.setString(7, workspaceAccessMode);
            stmt.setString(8, siblingOrderKey);
            stmt.executeUpdate();
        }
    }

    private UUID insertGroup(UUID workspaceId) throws SQLException {
        UUID groupId = UUID.randomUUID();
        try (PreparedStatement stmt =
                connection.prepareStatement("INSERT INTO workspace_groups (id, workspace_id, name) VALUES (?, ?, ?)")) {
            stmt.setObject(1, groupId);
            stmt.setObject(2, workspaceId);
            stmt.setString(3, "Group " + groupId);
            stmt.executeUpdate();
        }
        return groupId;
    }

    private void insertGroupGrant(UUID workspaceId, UUID documentId, UUID groupId) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO access_grants (workspace_id, document_id, group_id, effect, access_level) "
                        + "VALUES (?, ?, ?, 'ALLOW', 'VIEW')")) {
            stmt.setObject(1, workspaceId);
            stmt.setObject(2, documentId);
            stmt.setObject(3, groupId);
            stmt.executeUpdate();
        }
    }

    private void insertGrant(UUID workspaceId, UUID documentId, UUID userId) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO access_grants (workspace_id, document_id, user_id, effect, access_level) "
                        + "VALUES (?, ?, ?, 'ALLOW', 'VIEW')")) {
            stmt.setObject(1, workspaceId);
            stmt.setObject(2, documentId);
            stmt.setObject(3, userId);
            stmt.executeUpdate();
        }
    }

    /** Both tables share the same shape here, so one helper keeps the assertions symmetric. */
    private void insertOrder(String table, UUID userId, UUID documentId, String orderKey) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement("INSERT INTO " + table
                + " (user_id, document_id, order_key, created_at, updated_at) VALUES (?, ?, ?, now(), now())")) {
            stmt.setObject(1, userId);
            stmt.setObject(2, documentId);
            stmt.setString(3, orderKey);
            stmt.executeUpdate();
        }
    }

    private List<String> orderKeys(String table, UUID userId) throws SQLException {
        List<String> keys = new ArrayList<>();
        try (PreparedStatement stmt = connection.prepareStatement(
                "SELECT order_key FROM " + table + " WHERE user_id = ? ORDER BY order_key")) {
            stmt.setObject(1, userId);
            try (ResultSet rs = stmt.executeQuery()) {
                while (rs.next()) {
                    keys.add(rs.getString(1));
                }
            }
        }
        return keys;
    }

    private String orderKey(String table, UUID userId, UUID documentId) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "SELECT order_key FROM " + table + " WHERE user_id = ? AND document_id = ?")) {
            stmt.setObject(1, userId);
            stmt.setObject(2, documentId);
            try (ResultSet rs = stmt.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        }
    }

    private long countRows(String table) throws SQLException {
        try (Statement stmt = connection.createStatement();
                ResultSet rs = stmt.executeQuery("SELECT COUNT(*) FROM " + table)) {
            return rs.next() ? rs.getLong(1) : 0;
        }
    }
}
