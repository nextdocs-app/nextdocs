package com.nextdocs.api.document.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.nextdocs.api.PostgresTestSupport;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Applies V50 to a real V49 schema. The rest of the suite hand-writes the post-V50 grant
 * shape, so only this path can catch an upgrade that collides with a pre-existing row.
 */
class SharingAccessSourcesMigrationPostgresTest {
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
        schema = "sharingupgrade_" + UUID.randomUUID().toString().replace("-", "");
        flyway("49").migrate();
        try (Statement stmt = connection.createStatement()) {
            stmt.execute("SET search_path TO " + schema);
        }
    }

    private Flyway flyway(String target) {
        return Flyway.configure()
                .dataSource(url, username, password)
                .schemas(schema)
                .defaultSchema(schema)
                .createSchemas(true)
                .locations("classpath:db/migration")
                .target(target)
                .load();
    }

    @AfterEach
    void tearDown() throws Exception {
        if (connection != null && !connection.isClosed()) {
            try (Statement stmt = connection.createStatement()) {
                stmt.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
            } finally {
                connection.close();
            }
        }
    }

    @Test
    void upgradePreservesCreatorDenyAndCreatesMissingOwner() throws Exception {
        UUID user = UUID.randomUUID();
        UUID workspace = UUID.randomUUID();
        UUID denied = UUID.randomUUID();
        UUID ungranted = UUID.randomUUID();
        UUID demoted = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, 'hash', 'User', now(), now())")) {
            stmt.setObject(1, user);
            stmt.setString(2, user + "@example.com");
            stmt.executeUpdate();
        }
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, 'Workspace', now(), now())")) {
            stmt.setObject(1, workspace);
            stmt.executeUpdate();
        }
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO documents (id, user_id, workspace_id, title, workspace_access_mode, general_access_mode, link_access_level, created_at, updated_at) VALUES (?, ?, ?, 'Page', 'RESTRICTED', 'RESTRICTED', 'VIEW', now(), now())")) {
            for (UUID id : new UUID[] {denied, ungranted, demoted}) {
                stmt.setObject(1, id);
                stmt.setObject(2, user);
                stmt.setObject(3, workspace);
                stmt.executeUpdate();
            }
        }
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO access_grants (workspace_id, document_id, user_id, effect, access_level) VALUES (?, ?, ?, 'DENY', null)")) {
            stmt.setObject(1, workspace);
            stmt.setObject(2, denied);
            stmt.setObject(3, user);
            stmt.executeUpdate();
        }
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO access_grants (workspace_id, document_id, user_id, effect, access_level) VALUES (?, ?, ?, 'ALLOW', 'VIEW')")) {
            stmt.setObject(1, workspace);
            stmt.setObject(2, demoted);
            stmt.setObject(3, user);
            stmt.executeUpdate();
        }
        flyway("50").migrate();
        try (PreparedStatement stmt = connection.prepareStatement(
                "SELECT document_id, effect, access_level FROM access_grants WHERE user_id = ? ORDER BY document_id")) {
            stmt.setObject(1, user);
            try (ResultSet rs = stmt.executeQuery()) {
                int count = 0;
                while (rs.next()) {
                    UUID id = rs.getObject(1, UUID.class);
                    if (id.equals(denied)) {
                        assertThat(rs.getString(2)).isEqualTo("DENY");
                        assertThat(rs.getString(3)).isNull();
                    } else if (id.equals(demoted)) {
                        // A grant an owner deliberately lowered is never resurrected.
                        assertThat(rs.getString(2)).isEqualTo("ALLOW");
                        assertThat(rs.getString(3)).isEqualTo("VIEW");
                    } else {
                        assertThat(id).isEqualTo(ungranted);
                        assertThat(rs.getString(2)).isEqualTo("ALLOW");
                        assertThat(rs.getString(3)).isEqualTo("OWNER");
                    }
                    count++;
                }
                assertThat(count).isEqualTo(3);
            }
        }
        try (PreparedStatement stmt = connection.prepareStatement(
                "SELECT count(*) FROM pg_indexes WHERE schemaname = ? AND indexname = 'idx_documents_shared_listing_candidates'")) {
            stmt.setString(1, schema);
            try (ResultSet rs = stmt.executeQuery()) {
                rs.next();
                assertThat(rs.getInt(1)).isZero();
            }
        }
    }
}
