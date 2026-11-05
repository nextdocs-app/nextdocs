package com.nextdocs.api.document.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.nextdocs.api.PostgresTestSupport;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Runs the real Flyway migrations against PostgreSQL and pins the covering index the
 * shared listings rely on. H2 builds its schema through Hibernate with Flyway disabled,
 * so this DDL never executes in the unit suite.
 */
class SharedListingCandidateIndexMigrationPostgresTest {

    private Connection connection;
    private String schema;

    @BeforeEach
    void setUp() throws Exception {
        String url = PostgresTestSupport.resolveUrl();
        String username = PostgresTestSupport.resolveUsername();
        String password = PostgresTestSupport.resolvePassword();

        connection = PostgresTestSupport.connect(url, username, password);

        schema = "sharedlistingpg_" + UUID.randomUUID().toString().replace("-", "");
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
    void sharedListingIndex_coversTheCandidateColumnsWithoutYjsState() throws SQLException {
        String definition = indexDefinition("idx_documents_shared_listing_candidates");

        assertThat(definition)
                .contains("(updated_at DESC, created_at DESC, id)")
                .contains("INCLUDE (user_id, parent_id, sibling_order_key, title, workspace_id, workspace_access_mode)")
                .contains("deleted_at IS NULL")
                .contains("space_id IS NULL");
        assertThat(definition).doesNotContain("yjs_state");
    }

    private String indexDefinition(String indexName) throws SQLException {
        try (PreparedStatement stmt =
                connection.prepareStatement("SELECT indexdef FROM pg_indexes WHERE schemaname = ? AND indexname = ?")) {
            stmt.setString(1, schema);
            stmt.setString(2, indexName);
            try (ResultSet rs = stmt.executeQuery()) {
                assertThat(rs.next()).isTrue();
                return rs.getString(1);
            }
        }
    }
}
