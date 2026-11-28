package com.nextdocs.api.mention.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.nextdocs.api.PostgresTestSupport;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
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
 * Runs the mention ordering upsert against real PostgreSQL. H2 never sees it: the main
 * suite mocks this repository with search disabled and no migration table.
 */
class DocumentMentionVersionPostgresTest {

    private static Connection sharedConnection;
    private static String schema;
    private static String url;
    private static String username;
    private static String password;

    private Connection connection;
    private NamedParameterJdbcTemplate jdbc;
    private DocumentMentionVersionRepository repository;
    private UUID documentId;

    @BeforeAll
    static void migrate() {
        url = PostgresTestSupport.resolveUrl();
        username = PostgresTestSupport.resolveUsername();
        password = PostgresTestSupport.resolvePassword();
        schema = "pgtest_mentions_" + UUID.randomUUID().toString().replace("-", "");

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
    static void dropSchema() throws Exception {
        if (sharedConnection == null || sharedConnection.isClosed()) {
            return;
        }
        try (Statement stmt = sharedConnection.createStatement()) {
            stmt.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        } finally {
            sharedConnection.close();
        }
    }

    @BeforeEach
    void setUp() throws Exception {
        connection = PostgresTestSupport.connect(url, username, password);
        try (Statement stmt = connection.createStatement()) {
            stmt.execute("SET search_path TO " + schema + ", public");
            stmt.execute("TRUNCATE TABLE workspaces, users CASCADE");
        }
        jdbc = new NamedParameterJdbcTemplate(new SingleConnectionDataSource(connection, true));
        repository = new DocumentMentionVersionRepository(jdbc);
        documentId = insertDocument();
    }

    @AfterEach
    void tearDown() throws Exception {
        if (connection != null && !connection.isClosed()) {
            connection.close();
        }
    }

    @Test
    void firstClaimWinsAndANewerSetReplacesIt() {
        assertThat(repository.claim(documentId, at("2026-01-01T00:00:00Z"))).isTrue();
        assertThat(stored()).isEqualTo(at("2026-01-01T00:00:00Z"));

        assertThat(repository.claim(documentId, at("2026-01-01T00:00:05Z"))).isTrue();
        assertThat(stored()).isEqualTo(at("2026-01-01T00:00:05Z"));
    }

    @Test
    void anOlderSetIsRejectedAndLeavesTheMarkAlone() {
        repository.claim(documentId, at("2026-01-01T00:00:05Z"));

        // A retried content-updated call from the same older read must not resurrect a
        // mention the newer body removed.
        assertThat(repository.claim(documentId, at("2026-01-01T00:00:04Z"))).isFalse();
        assertThat(stored()).isEqualTo(at("2026-01-01T00:00:05Z"));
    }

    @Test
    void aRetryOfTheSameReadIsAccepted() {
        repository.claim(documentId, at("2026-01-01T00:00:05Z"));

        // Same ordering rule as the search upsert: an equal version is an idempotent
        // retry, not a stale write.
        assertThat(repository.claim(documentId, at("2026-01-01T00:00:05Z"))).isTrue();
    }

    @Test
    void aDeletedDocumentIsANoOpRatherThanAForeignKeyFailure() {
        assertThat(repository.claim(UUID.randomUUID(), at("2026-01-01T00:00:00Z")))
                .isFalse();
    }

    private OffsetDateTime stored() {
        return jdbc.queryForObject(
                "SELECT source_produced_at FROM document_mention_versions WHERE document_id = :id",
                new MapSqlParameterSource("id", documentId),
                (rs, rowNum) -> rs.getObject("source_produced_at", OffsetDateTime.class));
    }

    private static OffsetDateTime at(String value) {
        return OffsetDateTime.parse(value).withOffsetSameInstant(ZoneOffset.UTC);
    }

    private UUID insertDocument() throws SQLException {
        UUID workspaceId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, 'NextDocs', now(), now())")) {
            stmt.setObject(1, workspaceId);
            stmt.executeUpdate();
        }
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) "
                        + "VALUES (?, ?, 'hash', 'Test User', now(), now())")) {
            stmt.setObject(1, userId);
            stmt.setString(2, "pgtest-" + userId + "@example.com");
            stmt.executeUpdate();
        }
        UUID id = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO documents (id, created_by, workspace_id, title, general_access_mode, link_access_level, "
                        + "link_inherit_blocked, deleted_at, created_at, updated_at) "
                        + "VALUES (?, ?, ?, 'Doc', 'RESTRICTED', 'VIEW', FALSE, NULL, now(), now())")) {
            stmt.setObject(1, id);
            stmt.setObject(2, userId);
            stmt.setObject(3, workspaceId);
            stmt.executeUpdate();
        }
        return id;
    }
}
