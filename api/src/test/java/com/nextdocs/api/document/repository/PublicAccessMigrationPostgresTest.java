package com.nextdocs.api.document.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.nextdocs.api.PostgresTestSupport;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

/**
 * Migration & native query test against real PostgreSQL.
 * Exercises Postgres-specific SQL syntax (resolve_public_access recursive CTE,
 * unnest(string_to_array(..., ',')), ::uuid casts) that never executes in H2.
 *
 * <p>The fixture is built from nothing: every migration is applied by Flyway into a
 * throwaway schema. Replaying individual migration files on top of whichever schema
 * the test run happened to find used to pass against a Flyway-built dev database and
 * fail on an empty CI database, where the API suite creates its tables through
 * Hibernate (no named CHECK constraints) and the migration's
 * {@code DROP CONSTRAINT} had nothing to drop.
 */
class PublicAccessMigrationPostgresTest {

    private Connection connection;
    private String schema;
    private UUID testUserId;

    @BeforeEach
    void setUp() throws Exception {
        String url = PostgresTestSupport.resolveUrl();
        String username = PostgresTestSupport.resolveUsername();
        String password = PostgresTestSupport.resolvePassword();

        // No skip path: an unreachable database fails this test. The migration DDL
        // runs nowhere else, so a skip would be a hole in coverage.
        connection = PostgresTestSupport.connect(url, username, password);

        schema = "pgtest_" + UUID.randomUUID().toString().replace("-", "");
        Flyway.configure()
                .dataSource(url, username, password)
                .schemas(schema)
                .defaultSchema(schema)
                .createSchemas(true)
                .locations("classpath:db/migration")
                .target("30")
                .load()
                .migrate();

        try (Statement stmt = connection.createStatement()) {
            stmt.execute("SET search_path TO " + schema);
        }

        testUserId = insertUser();
    }

    @AfterEach
    void tearDown() throws Exception {
        if (connection == null || connection.isClosed()) {
            return;
        }
        try (Statement stmt = connection.createStatement()) {
            // Everything this test created lives in its own schema, so dropping the schema
            // is the cleanup: no per-row bookkeeping to miss.
            stmt.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        } finally {
            connection.close();
        }
    }

    /** Inserts a throwaway user and returns its id. */
    private UUID insertUser() throws SQLException {
        UUID userId = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) "
                        + "VALUES (?, ?, 'hash', 'Test User', now(), now())")) {
            stmt.setObject(1, userId);
            stmt.setString(2, "pgtest-" + userId + "@example.com");
            stmt.executeUpdate();
        }
        return userId;
    }

    private void insertDoc(
            UUID id, UUID parentId, String generalAccessMode, String linkAccessLevel, boolean blocked, boolean trashed)
            throws SQLException {
        String sql = "INSERT INTO documents (id, user_id, parent_id, title, yjs_state, general_access_mode, "
                + "link_access_level, link_inherit_blocked, sibling_order_key, deleted_at, created_at, updated_at) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now(), now())";
        try (PreparedStatement stmt = connection.prepareStatement(sql)) {
            stmt.setObject(1, id);
            stmt.setObject(2, testUserId);
            stmt.setObject(3, parentId);
            stmt.setString(4, "Test Doc " + id);
            stmt.setBytes(5, "seed".getBytes(StandardCharsets.UTF_8));
            stmt.setString(6, generalAccessMode);
            stmt.setString(7, linkAccessLevel != null ? linkAccessLevel : "VIEW");
            stmt.setBoolean(8, blocked);
            stmt.setString(9, parentId != null ? "a" + id.toString().substring(0, 4) : null);
            stmt.setTimestamp(10, trashed ? Timestamp.from(Instant.now()) : null);
            stmt.executeUpdate();
        }
    }

    private String resolvePublicAccess(UUID docId) throws SQLException {
        return scalarString("SELECT resolve_public_access(?)", docId);
    }

    private String scalarString(String sql, UUID argument) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(sql)) {
            stmt.setObject(1, argument);
            try (ResultSet rs = stmt.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        }
    }

    @Test
    void closestAncestorWins_resolvesInheritedAndOverrideCorrectly() throws SQLException {
        UUID root = UUID.randomUUID();
        UUID child = UUID.randomUUID();
        UUID grandchild = UUID.randomUUID();
        UUID greatGrandchild = UUID.randomUUID();

        // Root has ANYONE_WITH_LINK VIEW
        insertDoc(root, null, "ANYONE_WITH_LINK", "VIEW", false, false);
        // Child inherits through RESTRICTED
        insertDoc(child, root, "RESTRICTED", null, false, false);
        // Grandchild overrides with ANYONE_WITH_LINK EDIT
        insertDoc(grandchild, child, "ANYONE_WITH_LINK", "EDIT", false, false);
        // Great-grandchild inherits through RESTRICTED
        insertDoc(greatGrandchild, grandchild, "RESTRICTED", null, false, false);

        assertThat(resolvePublicAccess(root)).isEqualTo("VIEW");
        assertThat(resolvePublicAccess(child)).isEqualTo("VIEW");
        assertThat(resolvePublicAccess(grandchild)).isEqualTo("EDIT");
        assertThat(resolvePublicAccess(greatGrandchild)).isEqualTo("EDIT");
    }

    @Test
    void trashStop_stopsInheritanceAtDeletedAncestor() throws SQLException {
        UUID root = UUID.randomUUID();
        UUID child = UUID.randomUUID();
        UUID grandchild = UUID.randomUUID();

        insertDoc(root, null, "ANYONE_WITH_LINK", "EDIT", false, false);
        // Child is trashed
        insertDoc(child, root, "RESTRICTED", null, false, true);
        // Grandchild is active under trashed child
        insertDoc(grandchild, child, "RESTRICTED", null, false, false);

        assertThat(resolvePublicAccess(root)).isEqualTo("EDIT");
        assertThat(resolvePublicAccess(child)).isNull();
        assertThat(resolvePublicAccess(grandchild)).isNull();
    }

    @Test
    void linkInheritBlocked_blocksInheritanceUnlessOverridden() throws SQLException {
        UUID root = UUID.randomUUID();
        UUID child = UUID.randomUUID();
        UUID grandchild = UUID.randomUUID();
        UUID greatGrandchild = UUID.randomUUID();

        insertDoc(root, null, "ANYONE_WITH_LINK", "EDIT", false, false);
        // Child blocks link inheritance
        insertDoc(child, root, "RESTRICTED", null, true, false);
        // Grandchild inherits under blocked child
        insertDoc(grandchild, child, "RESTRICTED", null, false, false);
        // Great-grandchild re-enables with own ANYONE_WITH_LINK VIEW
        insertDoc(greatGrandchild, grandchild, "ANYONE_WITH_LINK", "VIEW", false, false);

        assertThat(resolvePublicAccess(root)).isEqualTo("EDIT");
        assertThat(resolvePublicAccess(child)).isNull();
        assertThat(resolvePublicAccess(grandchild)).isNull();
        assertThat(resolvePublicAccess(greatGrandchild)).isEqualTo("VIEW");
    }

    @Test
    void resolvePublicAccessBatch_executesPostgresUnnestSyntax() throws SQLException {
        UUID doc1 = UUID.randomUUID();
        UUID doc2 = UUID.randomUUID();
        UUID doc3 = UUID.randomUUID();

        insertDoc(doc1, null, "ANYONE_WITH_LINK", "VIEW", false, false);
        insertDoc(doc2, doc1, "ANYONE_WITH_LINK", "EDIT", false, false);
        insertDoc(doc3, null, "RESTRICTED", null, false, false);

        String ids = doc1 + "," + doc2 + "," + doc3;
        String sql = "SELECT u.id::uuid AS document_id, resolve_public_access(u.id::uuid) AS access_level "
                + "FROM unnest(string_to_array(?, ',')) AS u(id)";

        try (PreparedStatement stmt = connection.prepareStatement(sql)) {
            stmt.setString(1, ids);
            try (ResultSet rs = stmt.executeQuery()) {
                int count = 0;
                while (rs.next()) {
                    count++;
                    UUID id = (UUID) rs.getObject("document_id");
                    String access = rs.getString("access_level");
                    if (id.equals(doc1)) {
                        assertThat(access).isEqualTo("VIEW");
                    } else if (id.equals(doc2)) {
                        assertThat(access).isEqualTo("EDIT");
                    } else if (id.equals(doc3)) {
                        assertThat(access).isNull();
                    }
                }
                assertThat(count).isEqualTo(3);
            }
        }
    }

    /**
     * Runs {@code DocumentRepository#findPublicChildren} and its count query verbatim: the page
     * must contain exactly the children a reader can open, and the count must agree with it.
     */
    @Test
    void findPublicChildren_returnsOnlyReadableChildren() throws SQLException {
        UUID parent = UUID.randomUUID();
        UUID publicChild = UUID.randomUUID();
        UUID inheritedChild = UUID.randomUUID();
        UUID blockedChild = UUID.randomUUID();
        UUID trashedPublicChild = UUID.randomUUID();

        insertDoc(parent, null, "ANYONE_WITH_LINK", "VIEW", false, false);
        insertDoc(publicChild, parent, "RESTRICTED", null, false, false);
        insertDoc(inheritedChild, parent, "ANYONE_WITH_LINK", "COMMENT", false, false);
        insertDoc(blockedChild, parent, "RESTRICTED", null, true, false); // blocked -> private
        insertDoc(trashedPublicChild, parent, "ANYONE_WITH_LINK", "VIEW", false, true); // trashed

        assertThat(publicChildIds(parent)).containsExactlyInAnyOrder(publicChild, inheritedChild);
        assertThat(publicChildCount(parent)).isEqualTo(2);
        assertThat(publicChildCountsForParents(List.of(parent))).containsExactly(Map.entry(parent, 2L));
    }

    private List<UUID> publicChildIds(UUID parentId) {
        return namedQueryTemplate()
                .query(
                        DocumentRepository.PUBLIC_CHILDREN_SQL,
                        new MapSqlParameterSource("parentId", parentId),
                        (rs, rowNum) -> (UUID) rs.getObject("id"));
    }

    private long publicChildCount(UUID parentId) {
        Long count = namedQueryTemplate()
                .queryForObject(
                        DocumentRepository.PUBLIC_CHILDREN_COUNT_SQL,
                        new MapSqlParameterSource("parentId", parentId),
                        Long.class);
        return count == null ? 0L : count;
    }

    private List<Map.Entry<UUID, Long>> publicChildCountsForParents(List<UUID> parentIds) {
        return namedQueryTemplate()
                .query(
                        DocumentRepository.PUBLIC_CHILD_COUNTS_SQL,
                        new MapSqlParameterSource("parentIds", parentIds),
                        (rs, rowNum) -> Map.entry((UUID) rs.getObject("parent_id"), rs.getLong(2)));
    }

    private List<UUID> ancestorChain(UUID documentId) {
        return namedQuery(DocumentRepository.ANCESTOR_CHAIN_SQL, "documentId", documentId);
    }

    /**
     * Runs one of the repositories' own SQL strings, binding and reading its single UUID column.
     *
     * The query is taken from the repository constant rather than copied here: a copy
     * would keep passing after the shipped query changed, which is exactly the drift
     * these tests exist to catch. Named parameters are bound by name, so a renamed
     * placeholder fails here too.
     */
    private List<UUID> namedQuery(String sql, String parameterName, UUID value) {
        return namedQueryTemplate().queryForList(sql, new MapSqlParameterSource(parameterName, value), UUID.class);
    }

    private NamedParameterJdbcTemplate namedQueryTemplate() {
        return new NamedParameterJdbcTemplate(new SingleConnectionDataSource(connection, true));
    }
}
