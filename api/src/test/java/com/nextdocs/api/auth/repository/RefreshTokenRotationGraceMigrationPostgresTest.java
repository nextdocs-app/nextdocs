package com.nextdocs.api.auth.repository;

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
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Runs the real Flyway migrations against PostgreSQL and checks the rotation
 * grace column. The rest of the suite builds tables through Hibernate with
 * Flyway disabled, so {@code V26__refresh_token_rotation_grace.sql} never
 * executes there.
 */
class RefreshTokenRotationGraceMigrationPostgresTest {

    private Connection connection;
    private String schema;
    private UUID userId;

    @BeforeEach
    void setUp() throws Exception {
        String url = PostgresTestSupport.resolveUrl();
        String username = PostgresTestSupport.resolveUsername();
        String password = PostgresTestSupport.resolvePassword();

        connection = PostgresTestSupport.connect(url, username, password);

        schema = "rotgracepg_" + UUID.randomUUID().toString().replace("-", "");
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
        userId = insertUser();
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
    void migration_addsNullableRotatedAtTimestamp() throws SQLException {
        assertThat(columnNames("refresh_tokens")).contains("rotated_at");
        // Nullable is the point: logout and bulk revocation clear the column rather
        // than stamping it, so a deliberate revocation is never read as a rotation.
        assertThat(nullable("refresh_tokens", "rotated_at")).isTrue();
        assertThat(dataType("refresh_tokens", "rotated_at")).isEqualTo("timestamp with time zone");
    }

    @Test
    void rotatedAt_recordsRotationAndClearsOnRevocation() throws SQLException {
        UUID tokenId = insertRefreshToken();

        rotate(tokenId);
        assertThat(rotatedAt(tokenId)).isNotNull();

        revoke(tokenId);
        assertThat(rotatedAt(tokenId)).isNull();
    }

    private List<String> columnNames(String table) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = ?")) {
            stmt.setString(1, schema);
            stmt.setString(2, table);
            try (ResultSet rs = stmt.executeQuery()) {
                List<String> columns = new ArrayList<>();
                while (rs.next()) {
                    columns.add(rs.getString(1));
                }
                return columns;
            }
        }
    }

    private boolean nullable(String table, String column) throws SQLException {
        return "YES".equals(columnAttribute(table, column, "is_nullable"));
    }

    private String dataType(String table, String column) throws SQLException {
        return columnAttribute(table, column, "data_type");
    }

    private String columnAttribute(String table, String column, String attribute) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement("SELECT " + attribute
                + " FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?")) {
            stmt.setString(1, schema);
            stmt.setString(2, table);
            stmt.setString(3, column);
            try (ResultSet rs = stmt.executeQuery()) {
                assertThat(rs.next()).isTrue();
                return rs.getString(1);
            }
        }
    }

    private UUID insertUser() throws SQLException {
        UUID id = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) "
                        + "VALUES (?, ?, 'hash', 'Test User', now(), now())")) {
            stmt.setObject(1, id);
            stmt.setString(2, "rotgracepg-" + id + "@example.com");
            stmt.executeUpdate();
        }
        return id;
    }

    private UUID insertRefreshToken() throws SQLException {
        UUID id = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, is_revoked, created_at) "
                        + "VALUES (?, ?, ?, now() + interval '7 days', false, now())")) {
            stmt.setObject(1, id);
            stmt.setObject(2, userId);
            stmt.setString(3, id.toString());
            stmt.executeUpdate();
        }
        return id;
    }

    /** What {@code TokenService.rotateRefreshToken} writes. */
    private void rotate(UUID tokenId) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "UPDATE refresh_tokens SET is_revoked = true, rotated_at = now() WHERE id = ?")) {
            stmt.setObject(1, tokenId);
            assertThat(stmt.executeUpdate()).isOne();
        }
    }

    /** What logout and {@code revokeAllForUser} write. */
    private void revoke(UUID tokenId) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "UPDATE refresh_tokens SET is_revoked = true, rotated_at = NULL WHERE id = ?")) {
            stmt.setObject(1, tokenId);
            assertThat(stmt.executeUpdate()).isOne();
        }
    }

    private String rotatedAt(UUID tokenId) throws SQLException {
        try (PreparedStatement stmt =
                connection.prepareStatement("SELECT rotated_at FROM refresh_tokens WHERE id = ?")) {
            stmt.setObject(1, tokenId);
            try (ResultSet rs = stmt.executeQuery()) {
                assertThat(rs.next()).isTrue();
                return rs.getString(1);
            }
        }
    }
}
