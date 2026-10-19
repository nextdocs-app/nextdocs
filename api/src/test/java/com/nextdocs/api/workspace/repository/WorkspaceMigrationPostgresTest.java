package com.nextdocs.api.workspace.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.nextdocs.api.PostgresTestSupport;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Runs the real Flyway migrations against PostgreSQL and inspects the workspace schema.
 *
 * <p>The V19 backfill has to be exercised on a database that is mid-migration: the
 * schema is migrated up to V18, existing users are seeded, and only then is V19
 * applied. The rest of the suite builds tables through Hibernate with Flyway
 * disabled, so this DDL never executes there and a typo would only surface when a
 * self-hoster's database migrates.
 */
class WorkspaceMigrationPostgresTest {

    private Connection connection;
    private String schema;
    private final List<UUID> seededUsers = new ArrayList<>();

    @BeforeEach
    void setUp() throws Exception {
        String url = PostgresTestSupport.resolveUrl();
        String username = PostgresTestSupport.resolveUsername();
        String password = PostgresTestSupport.resolvePassword();

        // No skip path: an unreachable database fails this test. The migration DDL
        // runs nowhere else, so a skip would be a hole in coverage.
        connection = PostgresTestSupport.connect(url, username, password);
        schema = "workspacepg_" + UUID.randomUUID().toString().replace("-", "");

        // Upgrade paths are only meaningful from the schema the previous version
        // shipped, so stop at V18 before V19's backfill runs.
        migrate(url, username, password, "18");
        try (Statement stmt = connection.createStatement()) {
            stmt.execute("SET search_path TO " + schema);
        }
        // Oldest first: the backfill promotes the oldest active account to owner and
        // leaves a deactivated account out of the workspace entirely.
        seededUsers.add(insertUser("oldest@example.com", Instant.now().minusSeconds(300), false));
        seededUsers.add(insertUser("middle@example.com", Instant.now().minusSeconds(200), true));
        seededUsers.add(insertUser("newest@example.com", Instant.now().minusSeconds(100), true));
        migrate(url, username, password, null);
    }

    private void migrate(String url, String username, String password, String target) {
        migrateSchema(schema, url, username, password, target);
    }

    private void migrateSchema(
            String targetSchema, String url, String username, String password, String targetVersion) {
        var configuration = Flyway.configure()
                .dataSource(url, username, password)
                .schemas(targetSchema)
                .defaultSchema(targetSchema)
                .createSchemas(true)
                .locations("classpath:db/migration");
        if (targetVersion != null) {
            configuration = configuration.target(targetVersion);
        }
        configuration.load().migrate();
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
    void backfill_createsOneWorkspaceAndPromotesTheOldestActiveUserToOwner() throws SQLException {
        assertThat(countRows("workspaces")).isEqualTo(1);
        assertThat(workspaceName()).isEqualTo("NextDocs");
        assertThat(countRows("workspace_members")).isEqualTo(2);

        assertThat(hasMembership(seededUsers.get(0))).isFalse();
        assertThat(roleOf(seededUsers.get(1))).isEqualTo("OWNER");
        assertThat(roleOf(seededUsers.get(2))).isEqualTo("MEMBER");
    }

    @Test
    void workspaceMembers_rejectADuplicateMembership() throws SQLException {
        UUID userId = seededUsers.get(1);
        assertThatThrownBy(() -> insertMember(workspaceId(), userId)).isInstanceOf(SQLException.class);
    }

    @Test
    void workspaceMembers_rejectAnUnknownRole() throws SQLException {
        assertThatThrownBy(() -> insertMember(workspaceId(), seededUsers.get(0), "VIEWER"))
                .isInstanceOf(SQLException.class);
    }

    @Test
    void deletingAWorkspaceCascadesToItsMembers() throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement("DELETE FROM workspaces WHERE id = ?")) {
            stmt.setObject(1, workspaceId());
            stmt.executeUpdate();
        }
        assertThat(countRows("workspace_members")).isZero();
    }

    @Test
    void iconColor_isOnlyAllowedOnBuiltinIconsFromTheSharedPalette() throws SQLException {
        // A color without the builtin type is the row shape the constraint exists to stop:
        // the icon would be cleared or replaced and leave a stray palette key behind.
        assertThatThrownBy(() -> setIcon("EMOJI", "blue")).isInstanceOf(SQLException.class);
        assertThatThrownBy(() -> setIcon("BUILTIN", "chartreuse")).isInstanceOf(SQLException.class);
        setIcon("BUILTIN", "blue");
        assertThat(iconColor()).isEqualTo("blue");
    }

    @Test
    void workspaceInvites_haveExpectedColumnsAndDefaults() throws SQLException {
        Map<String, String[]> columns = columnFacts("workspace_invites");

        assertThat(columns)
                .containsOnlyKeys(
                        "id",
                        "workspace_id",
                        "email",
                        "role",
                        "token_hash",
                        "created_by",
                        "expires_at",
                        "accepted_at",
                        "accepted_by",
                        "created_at");
        for (Map.Entry<String, String[]> entry : columns.entrySet()) {
            boolean acceptedClaim =
                    entry.getKey().equals("accepted_at") || entry.getKey().equals("accepted_by");
            assertThat(entry.getValue()[0])
                    .as("%s nullability", entry.getKey())
                    .isEqualTo(acceptedClaim ? "YES" : "NO");
        }
        // The id must be mintable without the application supplying one, and created_at
        // must land even on a direct SQL insert.
        assertThat(columns.get("id")[1]).contains("gen_random_uuid");
        assertThat(columns.get("created_at")[1]).contains("now()");
    }

    @Test
    void workspaceInvites_tokenHashIsUnique() throws SQLException {
        insertInvite(workspaceId(), "jane@example.com", "a".repeat(64));

        // A token hash maps to at most one invite; a second row with the same hash is a
        // bug, and the uniqueness is the backstop for the hash-only claim lookup.
        assertThatThrownBy(() -> insertInvite(workspaceId(), "john@example.com", "a".repeat(64)))
                .isInstanceOf(SQLException.class);
    }

    @Test
    void workspaceInvites_onePendingInvitePerEmailIsEnforcedByAPartialUniqueIndex() throws SQLException {
        UUID workspace = workspaceId();
        insertInvite(workspace, "jane@example.com");

        // A second pending invite for the same address is a bug: re-inviting replaces
        // the row in code, and this index is what backs that invariant.
        assertThatThrownBy(() -> insertInvite(workspace, "jane@example.com")).isInstanceOf(SQLException.class);

        // Accepted rows are outside the partial index, so re-inviting an address that
        // already joined (or was removed) stays allowed and the audit trail unconstrained.
        try (PreparedStatement stmt = connection.prepareStatement(
                "UPDATE workspace_invites SET accepted_at = now(), accepted_by = ? WHERE email = ?")) {
            stmt.setObject(1, seededUsers.get(0));
            stmt.setString(2, "jane@example.com");
            assertThat(stmt.executeUpdate()).isEqualTo(1);
        }
        insertInvite(workspace, "jane@example.com");
        assertThat(countRows("workspace_invites")).isEqualTo(2);
    }

    @Test
    void workspaceInvites_acceptedByMustReferenceAUser() throws SQLException {
        UUID inviteId = insertInvite(workspaceId(), "jane@example.com");

        // The claim is a one-way transition: only an accepted row references the
        // accepting user, and that user must exist.
        try (PreparedStatement stmt = connection.prepareStatement(
                "UPDATE workspace_invites SET accepted_at = now(), accepted_by = ? WHERE id = ?")) {
            stmt.setObject(1, UUID.randomUUID());
            stmt.setObject(2, inviteId);
            assertThatThrownBy(stmt::executeUpdate).isInstanceOf(SQLException.class);
        }
    }

    @Test
    void workspaceInvites_deletingTheWorkspaceCascades() throws SQLException {
        UUID workspace = workspaceId();
        insertInvite(workspace, "jane@example.com");

        assertThat(countRows("workspace_invites")).isEqualTo(1);

        try (PreparedStatement stmt = connection.prepareStatement("DELETE FROM workspaces WHERE id = ?")) {
            stmt.setObject(1, workspace);
            stmt.executeUpdate();
        }
        assertThat(countRows("workspace_invites")).isZero();
    }

    @Test
    void workspaceInvites_pendingLookupIsCoveredByAPartialIndex() throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "SELECT indexdef FROM pg_indexes WHERE schemaname = ? AND tablename = 'workspace_invites'")) {
            stmt.setString(1, schema);
            try (ResultSet rs = stmt.executeQuery()) {
                List<String> definitions = new ArrayList<>();
                while (rs.next()) {
                    definitions.add(rs.getString(1));
                }
                // The People view lists pending invites; accepted history must stay out
                // of the index so it does not grow with the audit trail.
                assertThat(definitions)
                        .anySatisfy(def -> assertThat(def)
                                .contains("uq_workspace_invites_pending_email")
                                .contains("WHERE (accepted_at IS NULL)"));
            }
        }
    }

    @Test
    void instanceLock_holdsExactlyOneSeededRow() throws SQLException {
        Map<String, String[]> columns = columnFacts("instance_lock");

        assertThat(columns).containsOnlyKeys("id");
        assertThat(columns.get("id")[0]).isEqualTo("NO");
        // V22 seeds the singleton row; registration takes its write lock to serialize
        // the bootstrap check-then-insert on an otherwise empty database.
        assertThat(countRows("instance_lock")).isEqualTo(1);

        try (PreparedStatement stmt = connection.prepareStatement("INSERT INTO instance_lock (id) VALUES (2)")) {
            assertThatThrownBy(stmt::executeUpdate).isInstanceOf(SQLException.class);
        }
    }

    private UUID insertInvite(UUID workspace, String email) throws SQLException {
        return insertInvite(workspace, email, "hash-" + UUID.randomUUID());
    }

    private UUID insertInvite(UUID workspace, String email, String tokenHash) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO workspace_invites (workspace_id, email, role, token_hash, created_by, expires_at) "
                        + "VALUES (?, ?, 'MEMBER', ?, ?, now() + interval '7 days') RETURNING id")) {
            stmt.setObject(1, workspace);
            stmt.setString(2, email);
            stmt.setString(3, tokenHash);
            stmt.setObject(4, seededUsers.get(0));
            try (ResultSet rs = stmt.executeQuery()) {
                rs.next();
                return (UUID) rs.getObject(1);
            }
        }
    }

    private Map<String, String[]> columnFacts(String table) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "SELECT column_name, is_nullable, column_default FROM information_schema.columns "
                        + "WHERE table_schema = ? AND table_name = ?")) {
            stmt.setString(1, schema);
            stmt.setString(2, table);
            try (ResultSet rs = stmt.executeQuery()) {
                Map<String, String[]> facts = new LinkedHashMap<>();
                while (rs.next()) {
                    facts.put(rs.getString(1), new String[] {rs.getString(2), rs.getString(3)});
                }
                return facts;
            }
        }
    }

    @Test
    void freshDatabase_migratesWithoutCreatingAWorkspace() throws Exception {
        String freshSchema = "workspacepg_fresh_" + UUID.randomUUID().toString().replace("-", "");
        String url = PostgresTestSupport.resolveUrl();
        try {
            var configuration = Flyway.configure()
                    .dataSource(url, PostgresTestSupport.resolveUsername(), PostgresTestSupport.resolvePassword())
                    .schemas(freshSchema)
                    .defaultSchema(freshSchema)
                    .createSchemas(true)
                    .locations("classpath:db/migration")
                    .load();
            configuration.migrate();
            try (Connection fresh = PostgresTestSupport.connect(
                            url, PostgresTestSupport.resolveUsername(), PostgresTestSupport.resolvePassword());
                    Statement stmt = fresh.createStatement()) {
                stmt.execute("SET search_path TO " + freshSchema);
                try (ResultSet rs = stmt.executeQuery("SELECT count(*) FROM workspaces")) {
                    rs.next();
                    // The first registration bootstraps the workspace and its owner in code,
                    // where the auth flow also decides that it requires no invite.
                    assertThat(rs.getInt(1)).isZero();
                }
            }
        } finally {
            try (Statement stmt = connection.createStatement()) {
                stmt.execute("DROP SCHEMA IF EXISTS " + freshSchema + " CASCADE");
            }
        }
    }

    @Test
    void backfill_failsLoudlyWhenEveryExistingAccountIsDeactivated() throws Exception {
        String legacySchema =
                "workspacepg_inactive_" + UUID.randomUUID().toString().replace("-", "");
        String url = PostgresTestSupport.resolveUrl();
        String username = PostgresTestSupport.resolveUsername();
        String password = PostgresTestSupport.resolvePassword();
        try {
            migrateSchema(legacySchema, url, username, password, "18");
            try (Statement stmt = connection.createStatement()) {
                stmt.execute("SET search_path TO " + legacySchema);
            }
            insertUser("deactivated@example.com", Instant.now(), false);

            // Completing the migration with no active owner would leave the workspace
            // unadministrable, so the backfill refuses instead of crowning an account
            // that cannot sign in.
            assertThatThrownBy(() -> migrateSchema(legacySchema, url, username, password, null))
                    .hasStackTraceContaining("no active user");
        } finally {
            try (Statement stmt = connection.createStatement()) {
                stmt.execute("SET search_path TO " + schema);
                stmt.execute("DROP SCHEMA IF EXISTS " + legacySchema + " CASCADE");
            }
        }
    }

    private UUID insertUser(String email, Instant createdAt, boolean active) throws SQLException {
        UUID id = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO users (id, email, password_hash, display_name, is_active, created_at, updated_at) "
                        + "VALUES (?, ?, 'hash', 'Test User', ?, ?, ?)")) {
            stmt.setObject(1, id);
            stmt.setString(2, email);
            stmt.setBoolean(3, active);
            stmt.setTimestamp(4, Timestamp.from(createdAt));
            stmt.setTimestamp(5, Timestamp.from(createdAt));
            stmt.executeUpdate();
        }
        return id;
    }

    private boolean hasMembership(UUID userId) throws SQLException {
        try (PreparedStatement stmt =
                connection.prepareStatement("SELECT count(*) FROM workspace_members WHERE user_id = ?")) {
            stmt.setObject(1, userId);
            try (ResultSet rs = stmt.executeQuery()) {
                rs.next();
                return rs.getInt(1) > 0;
            }
        }
    }

    private void insertMember(UUID workspace, UUID userId) throws SQLException {
        insertMember(workspace, userId, "MEMBER");
    }

    private void insertMember(UUID workspace, UUID userId, String role) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)")) {
            stmt.setObject(1, workspace);
            stmt.setObject(2, userId);
            stmt.setString(3, role);
            stmt.executeUpdate();
        }
    }

    private void setIcon(String iconType, String iconColor) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "UPDATE workspaces SET icon_type = ?, icon_value = 'home', icon_color = ? WHERE id = ?")) {
            stmt.setString(1, iconType);
            stmt.setString(2, iconColor);
            stmt.setObject(3, workspaceId());
            stmt.executeUpdate();
        }
    }

    private String roleOf(UUID userId) throws SQLException {
        try (PreparedStatement stmt =
                connection.prepareStatement("SELECT role FROM workspace_members WHERE user_id = ?")) {
            stmt.setObject(1, userId);
            try (ResultSet rs = stmt.executeQuery()) {
                rs.next();
                return rs.getString(1);
            }
        }
    }

    private UUID workspaceId() throws SQLException {
        try (Statement stmt = connection.createStatement();
                ResultSet rs = stmt.executeQuery("SELECT id FROM workspaces LIMIT 1")) {
            rs.next();
            return (UUID) rs.getObject(1);
        }
    }

    private String workspaceName() throws SQLException {
        try (Statement stmt = connection.createStatement();
                ResultSet rs = stmt.executeQuery("SELECT name FROM workspaces LIMIT 1")) {
            rs.next();
            return rs.getString(1);
        }
    }

    private String iconColor() throws SQLException {
        try (Statement stmt = connection.createStatement();
                ResultSet rs = stmt.executeQuery("SELECT icon_color FROM workspaces LIMIT 1")) {
            rs.next();
            return rs.getString(1);
        }
    }

    private int countRows(String table) throws SQLException {
        try (Statement stmt = connection.createStatement();
                ResultSet rs = stmt.executeQuery("SELECT count(*) FROM " + table)) {
            rs.next();
            return rs.getInt(1);
        }
    }
}
