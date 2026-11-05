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
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Pins the final cleanup of the legacy sharing schema. V31 backfilled the collaborator
 * rows into {@code access_grants} and V35 moved the last runtime readers over; V40 is
 * therefore expected to leave neither the table nor its compatibility alias behind.
 */
class LegacyCollaboratorSchemaCleanupPostgresTest {

    private Connection connection;
    private String schema;

    @BeforeEach
    void setUp() throws Exception {
        String url = PostgresTestSupport.resolveUrl();
        String username = PostgresTestSupport.resolveUsername();
        String password = PostgresTestSupport.resolvePassword();

        connection = PostgresTestSupport.connect(url, username, password);

        schema = "legacycollab_" + UUID.randomUUID().toString().replace("-", "");
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
    void legacyCollaboratorTableAndAliasAreGone() throws SQLException {
        assertThat(relationExists("document_collaborators")).isFalse();
        assertThat(functionExists("has_positive_ancestor_grant(uuid,uuid)")).isFalse();

        // The canonical store and identity gate remain the only sharing schema.
        assertThat(relationExists("access_grants")).isTrue();
        assertThat(functionExists("has_positive_identity_grant(uuid,uuid)")).isTrue();
        assertThat(currentFunctionsReferencing("document_collaborators")).isEmpty();
    }

    private boolean relationExists(String relation) throws SQLException {
        return scalarBoolean("SELECT to_regclass(?) IS NOT NULL", relation);
    }

    private boolean functionExists(String signature) throws SQLException {
        return scalarBoolean("SELECT to_regprocedure(?) IS NOT NULL", signature);
    }

    private boolean scalarBoolean(String sql, String argument) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(sql)) {
            stmt.setString(1, argument);
            try (ResultSet rs = stmt.executeQuery()) {
                return rs.next() && rs.getBoolean(1);
            }
        }
    }

    private List<String> currentFunctionsReferencing(String tableName) throws SQLException {
        String sql = "SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' "
                + "FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
                + "WHERE n.nspname = current_schema() AND p.prokind = 'f' "
                + "AND pg_get_functiondef(p.oid) LIKE ?";
        try (PreparedStatement stmt = connection.prepareStatement(sql)) {
            stmt.setString(1, "%" + tableName + "%");
            try (ResultSet rs = stmt.executeQuery()) {
                List<String> functions = new ArrayList<>();
                while (rs.next()) {
                    functions.add(rs.getString(1));
                }
                return functions;
            }
        }
    }
}
