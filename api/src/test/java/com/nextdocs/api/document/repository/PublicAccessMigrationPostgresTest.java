package com.nextdocs.api.document.repository;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

/**
 * Migration & native query test against real PostgreSQL.
 * Exercises Postgres-specific SQL syntax (resolve_public_access recursive CTE,
 * unnest(string_to_array(..., ',')), ::uuid casts) that never executes in H2.
 */
class PublicAccessMigrationPostgresTest {

    private Connection connection;
    private final List<UUID> createdDocIds = new ArrayList<>();
    private final List<UUID> createdUserIds = new ArrayList<>();
    private UUID testUserId;

    @BeforeEach
    void setUp() throws Exception {
        String url = System.getProperty(
                "spring.datasource.url",
                System.getenv().getOrDefault("SPRING_DATASOURCE_URL", "jdbc:postgresql://localhost:5433/nextdocs"));
        String username = System.getProperty(
                "spring.datasource.username", System.getenv().getOrDefault("SPRING_DATASOURCE_USERNAME", "nextdocs"));
        String password = System.getProperty(
                "spring.datasource.password", System.getenv().getOrDefault("SPRING_DATASOURCE_PASSWORD", "nextdocs"));

        try {
            connection = DriverManager.getConnection(url, username, password);
        } catch (SQLException e) {
            Assumptions.assumeTrue(false, "PostgreSQL not reachable at " + url + ": " + e.getMessage());
            return;
        }

        // Apply the real V14 migration file so drift between the SQL and the
        // @Query/native callers is caught here instead of shipping green.
        try (Statement stmt = connection.createStatement()) {
            stmt.execute(loadMigrationSql());
        }

        testUserId = insertUser();
    }

    /** Inserts a throwaway user and returns its id; removed again in {@link #tearDown()}. */
    private UUID insertUser() throws SQLException {
        UUID userId = UUID.randomUUID();
        createdUserIds.add(userId);
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) "
                        + "VALUES (?, ?, 'hash', 'Test User', now(), now()) ON CONFLICT DO NOTHING")) {
            stmt.setObject(1, userId);
            stmt.setString(2, "pgtest-" + userId + "@example.com");
            stmt.executeUpdate();
        }
        return userId;
    }

    @AfterEach
    void tearDown() throws Exception {
        if (connection == null || connection.isClosed()) {
            return;
        }
        try (Statement stmt = connection.createStatement()) {
            for (UUID docId : createdDocIds) {
                stmt.execute("DELETE FROM document_collaborators WHERE document_id = '" + docId + "'");
                stmt.execute("DELETE FROM documents WHERE id = '" + docId + "'");
            }
            for (UUID userId : createdUserIds) {
                stmt.execute("DELETE FROM users WHERE id = '" + userId + "'");
            }
        } finally {
            connection.close();
        }
    }

    private void insertDoc(
            UUID id, UUID parentId, String generalAccessMode, String linkAccessLevel, boolean blocked, boolean trashed)
            throws SQLException {
        createdDocIds.add(id);
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

    private void insertCollaborator(UUID documentId, UUID userId, String accessLevel) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO document_collaborators (document_id, user_id, access_level, created_at, updated_at) "
                        + "VALUES (?, ?, ?, now(), now())")) {
            stmt.setObject(1, documentId);
            stmt.setObject(2, userId);
            stmt.setString(3, accessLevel);
            stmt.executeUpdate();
        }
    }

    private static String loadMigrationSql() throws SQLException {
        try (java.io.InputStream in = PublicAccessMigrationPostgresTest.class
                .getClassLoader()
                .getResourceAsStream("db/migration/V14__public_access_resolution.sql")) {
            if (in == null) {
                throw new SQLException("V14__public_access_resolution.sql not found on the test classpath");
            }
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (java.io.IOException e) {
            throw new SQLException("Failed to read V14__public_access_resolution.sql", e);
        }
    }

    private String resolvePublicAccess(UUID docId) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement("SELECT resolve_public_access(?)")) {
            stmt.setObject(1, docId);
            try (ResultSet rs = stmt.executeQuery()) {
                if (rs.next()) {
                    return rs.getString(1);
                }
            }
        }
        return null;
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
     * Runs {@code DocumentCollaboratorRepository#findCollaboratorUserIdsWithAncestorGrant}
     * verbatim: the batched ancestor check must agree with the per-row function call it replaced.
     */
    @Test
    void batchedAncestorGrantQuery_agreesWithPerRowFunctionCalls() throws SQLException {
        UUID root = UUID.randomUUID();
        UUID child = UUID.randomUUID();
        UUID grandchild = UUID.randomUUID();
        UUID grantedUser = insertUser();
        UUID revokedUser = insertUser();

        insertDoc(root, null, "RESTRICTED", null, false, false);
        insertDoc(child, root, "RESTRICTED", null, false, false);
        insertDoc(grandchild, child, "RESTRICTED", null, false, false);

        // Both users collaborate on the grandchild itself; only one still holds a
        // positive grant further up the tree, the other was broken with NO_ACCESS.
        insertCollaborator(grandchild, grantedUser, "EDIT");
        insertCollaborator(grandchild, revokedUser, "EDIT");
        insertCollaborator(root, grantedUser, "VIEW");
        insertCollaborator(root, revokedUser, "NO_ACCESS");

        List<UUID> batched = collaboratorUserIdsWithAncestorGrant(grandchild);
        assertThat(batched).containsExactly(grantedUser);

        List<UUID> perRow = new ArrayList<>();
        for (UUID collaboratorUserId : collaboratorUserIds(grandchild)) {
            if (hasPositiveAncestorGrant(collaboratorUserId, grandchild)) {
                perRow.add(collaboratorUserId);
            }
        }
        assertThat(batched).containsExactlyElementsOf(perRow);
    }

    /**
     * Runs {@code DocumentRepository#findAncestorChainIds} verbatim: callers index into the
     * result by level, so the closest ancestor must come first and a root must yield nothing.
     */
    @Test
    void ancestorChainQuery_returnsClosestAncestorFirst() throws SQLException {
        UUID root = UUID.randomUUID();
        UUID child = UUID.randomUUID();
        UUID grandchild = UUID.randomUUID();

        insertDoc(root, null, "RESTRICTED", null, false, false);
        insertDoc(child, root, "RESTRICTED", null, false, false);
        insertDoc(grandchild, child, "RESTRICTED", null, false, false);

        assertThat(ancestorChain(grandchild)).containsExactly(child, root);
        assertThat(ancestorChain(child)).containsExactly(root);
        assertThat(ancestorChain(root)).isEmpty();
    }

    private List<UUID> collaboratorUserIdsWithAncestorGrant(UUID documentId) throws SQLException {
        return namedQuery(DocumentCollaboratorRepository.COLLABORATOR_ANCESTOR_GRANT_SQL, documentId, "user_id");
    }

    private List<UUID> collaboratorUserIds(UUID documentId) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "SELECT user_id FROM document_collaborators WHERE document_id = ? ORDER BY created_at")) {
            stmt.setObject(1, documentId);
            try (ResultSet rs = stmt.executeQuery()) {
                List<UUID> userIds = new ArrayList<>();
                while (rs.next()) {
                    userIds.add((UUID) rs.getObject("user_id"));
                }
                return userIds;
            }
        }
    }

    private boolean hasPositiveAncestorGrant(UUID userId, UUID documentId) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement("SELECT has_positive_ancestor_grant(?, ?)")) {
            stmt.setObject(1, userId);
            stmt.setObject(2, documentId);
            try (ResultSet rs = stmt.executeQuery()) {
                return rs.next() && rs.getBoolean(1);
            }
        }
    }

    private List<UUID> ancestorChain(UUID documentId) throws SQLException {
        return namedQuery(DocumentRepository.ANCESTOR_CHAIN_SQL, documentId, "id");
    }

    /**
     * Runs one of the repositories' own SQL strings, binding and reading one column.
     *
     * The query is taken from the repository constant rather than copied here: a copy
     * would keep passing after the shipped query changed, which is exactly the drift
     * these tests exist to catch. Named parameters are bound by name, so a renamed
     * placeholder fails here too.
     */
    private List<UUID> namedQuery(String sql, UUID documentId, String column) throws SQLException {
        MapSqlParameterSource params = new MapSqlParameterSource("documentId", documentId);
        NamedParameterJdbcTemplate jdbc =
                new NamedParameterJdbcTemplate(new SingleConnectionDataSource(connection, true));
        return jdbc.queryForList(sql, params, UUID.class);
    }

    @Test
    void findPublicChildren_returnsOnlyPublicChildren() throws SQLException {
        UUID parent = UUID.randomUUID();
        UUID publicChild = UUID.randomUUID();
        UUID privateChild = UUID.randomUUID();
        UUID trashedPublicChild = UUID.randomUUID();

        insertDoc(parent, null, "ANYONE_WITH_LINK", "VIEW", false, false);
        insertDoc(publicChild, parent, "RESTRICTED", null, false, false);
        insertDoc(privateChild, parent, "RESTRICTED", null, true, false); // blocked -> private
        insertDoc(trashedPublicChild, parent, "ANYONE_WITH_LINK", "VIEW", false, true); // trashed

        String sql = "SELECT d.id FROM documents d "
                + "WHERE d.parent_id = ? AND d.deleted_at IS NULL "
                + "AND resolve_public_access(d.id) IS NOT NULL";

        try (PreparedStatement stmt = connection.prepareStatement(sql)) {
            stmt.setObject(1, parent);
            try (ResultSet rs = stmt.executeQuery()) {
                List<UUID> returnedIds = new ArrayList<>();
                while (rs.next()) {
                    returnedIds.add((UUID) rs.getObject("id"));
                }
                assertThat(returnedIds).containsExactly(publicChild);
            }
        }
    }
}
