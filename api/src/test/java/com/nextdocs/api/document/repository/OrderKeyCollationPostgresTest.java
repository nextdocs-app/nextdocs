package com.nextdocs.api.document.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.nextdocs.api.PostgresTestSupport;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * V46 against real PostgreSQL: every fractional order-key column must compare in byte
 * order.
 *
 * <p>Java compares these keys with {@code String.compareTo}, so the database has to agree.
 * Under a libc locale such as en_US.UTF-8 it does not: {@code keyBetween(null, "a0")} is
 * "Zz", which SQL sorts after "a0" while Java sorts it before. The SQL neighbour query
 * then hands the move an inverted interval and it fails with "a must be less than b".
 *
 * <p>Asserting the column's collation rather than only the sort behavior keeps this
 * meaningful on a server whose own locale is already "C" — musl builds have no
 * en_US.UTF-8 data, so the bug does not reproduce there, but the collation is missing all
 * the same.
 */
class OrderKeyCollationPostgresTest {

    private Connection connection;
    private String schema;

    @BeforeEach
    void setUp() throws Exception {
        String url = PostgresTestSupport.resolveUrl();
        String username = PostgresTestSupport.resolveUsername();
        String password = PostgresTestSupport.resolvePassword();

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
    void everyOrderKeyColumnUsesTheByteOrderCollation() throws SQLException {
        List<String[]> columns = List.of(
                new String[] {"user_shared_document_orders", "order_key"},
                new String[] {"user_document_orders", "order_key"},
                new String[] {"user_space_orders", "order_key"},
                new String[] {"documents", "sibling_order_key"});

        for (String[] column : columns) {
            assertThat(collationOf(column[0], column[1]))
                    .as("collation of %s.%s", column[0], column[1])
                    .isEqualTo("C");
        }
    }

    @Test
    void siblingKeysOrderTheWayJavaComparesThem() throws SQLException {
        UUID owner = insertUser();
        insertDoc(owner, "a0");
        insertDoc(owner, "Zz");

        assertThat(siblingKeys()).containsExactly("Zz", "a0");
        assertThat(minSiblingKey()).isEqualTo("Zz");
    }

    private String collationOf(String table, String column) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement("SELECT c.collname FROM pg_attribute a "
                + "JOIN pg_class cl ON cl.oid = a.attrelid "
                + "JOIN pg_namespace n ON n.oid = cl.relnamespace "
                + "JOIN pg_collation c ON c.oid = a.attcollation "
                + "WHERE n.nspname = ? AND cl.relname = ? AND a.attname = ?")) {
            stmt.setString(1, schema);
            stmt.setString(2, table);
            stmt.setString(3, column);
            try (ResultSet rs = stmt.executeQuery()) {
                assertThat(rs.next()).as("column %s.%s exists", table, column).isTrue();
                return rs.getString(1);
            }
        }
    }

    private List<String> siblingKeys() throws SQLException {
        try (Statement stmt = connection.createStatement();
                ResultSet rs = stmt.executeQuery(
                        "SELECT sibling_order_key FROM documents ORDER BY sibling_order_key ASC, id ASC")) {
            List<String> keys = new java.util.ArrayList<>();
            while (rs.next()) {
                keys.add(rs.getString(1));
            }
            return keys;
        }
    }

    private String minSiblingKey() throws SQLException {
        try (Statement stmt = connection.createStatement();
                ResultSet rs = stmt.executeQuery("SELECT MIN(sibling_order_key) FROM documents")) {
            return rs.next() ? rs.getString(1) : null;
        }
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
        UUID workspaceId = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, 'NextDocs', now(), now())")) {
            stmt.setObject(1, workspaceId);
            stmt.executeUpdate();
        }
        try (PreparedStatement stmt =
                connection.prepareStatement("INSERT INTO workspace_members (workspace_id, user_id, role, created_at) "
                        + "VALUES (?, ?, 'MEMBER', now())")) {
            stmt.setObject(1, workspaceId);
            stmt.setObject(2, id);
            stmt.executeUpdate();
        }
        return id;
    }

    private void insertDoc(UUID ownerId, String siblingOrderKey) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO documents (id, created_by, workspace_id, title, general_access_mode, "
                        + "link_access_level, workspace_access_mode, workspace_access_level, sibling_order_key, "
                        + "created_at, updated_at) "
                        + "VALUES (?, ?, (SELECT workspace_id FROM workspace_members WHERE user_id = ?), ?, "
                        + "'RESTRICTED', 'VIEW', 'RESTRICTED', 'VIEW', ?, now(), now())")) {
            stmt.setObject(1, UUID.randomUUID());
            stmt.setObject(2, ownerId);
            stmt.setObject(3, ownerId);
            stmt.setString(4, "Page " + siblingOrderKey);
            stmt.setString(5, siblingOrderKey);
            stmt.executeUpdate();
        }
    }
}
