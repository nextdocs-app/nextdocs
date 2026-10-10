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
import java.util.ArrayList;
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
 * unnest(string_to_array(..., ',')), ::uuid casts, DELETE ... USING) that never
 * executes in H2.
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

    private String resolvePublicAccess(UUID docId) throws SQLException {
        return scalarString("SELECT resolve_public_access(?)", docId);
    }

    private String resolveEffectiveAccess(UUID userId, UUID docId) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement("SELECT resolve_effective_access(?, ?)")) {
            stmt.setObject(1, userId);
            stmt.setObject(2, docId);
            try (ResultSet rs = stmt.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        }
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
     * {@code has_positive_ancestor_grant} deliberately ignores {@code deleted_at} while
     * {@code resolve_effective_access} stops at trash. The difference is the point: a NO_ACCESS
     * breakpoint has to outlive the trash of the ancestor that justified it, so restoring that
     * ancestor re-arms it, even though the descendant stays private until then.
     */
    @Test
    void ancestorGrant_ignoresTrashWhileResolutionStopsAtIt() throws SQLException {
        UUID root = UUID.randomUUID();
        UUID trashedChild = UUID.randomUUID();
        UUID grandchild = UUID.randomUUID();
        UUID collaborator = insertUser();

        insertDoc(root, null, "RESTRICTED", null, false, false);
        insertDoc(trashedChild, root, "RESTRICTED", null, false, true);
        insertDoc(grandchild, trashedChild, "RESTRICTED", null, false, false);

        insertCollaborator(root, collaborator, "EDIT");
        insertCollaborator(grandchild, collaborator, "NO_ACCESS");

        // Walks through the trashed ancestor...
        assertThat(hasPositiveAncestorGrant(collaborator, grandchild)).isTrue();
        // ...so pruning keeps the breakpoint row...
        assertThat(pruneOrphanedBreakpoints(root)).isZero();
        assertThat(collaboratorUserIds(grandchild)).containsExactly(collaborator);
        // ...while the grant itself does not resolve above a trash bundle.
        assertThat(resolveEffectiveAccess(collaborator, grandchild)).isNull();
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

    /**
     * Runs {@code DocumentCollaboratorRepository#pruneOrphanedBreakpoints} verbatim: only the
     * breakpoints whose user lost every positive ancestor grant may go, and only inside the
     * subtree. A copied statement would keep passing after the shipped one changed.
     */
    @Test
    void pruneOrphanedBreakpoints_deletesOnlyGrantlessBreakpointsInSubtree() throws SQLException {
        UUID root = UUID.randomUUID();
        UUID child = UUID.randomUUID();
        UUID grandchild = UUID.randomUUID();
        UUID outside = UUID.randomUUID();
        UUID keptUser = insertUser();
        UUID orphanedUser = insertUser();

        insertDoc(root, null, "RESTRICTED", null, false, false);
        insertDoc(child, root, "RESTRICTED", null, false, false);
        insertDoc(grandchild, child, "RESTRICTED", null, false, false);
        insertDoc(outside, null, "RESTRICTED", null, false, false);

        // keptUser still holds a positive grant above the breakpoint.
        insertCollaborator(root, keptUser, "EDIT");
        insertCollaborator(grandchild, keptUser, "NO_ACCESS");
        // orphanedUser's only positive grant was on the child, which now holds a breakpoint.
        insertCollaborator(root, orphanedUser, "NO_ACCESS");
        insertCollaborator(child, orphanedUser, "NO_ACCESS");
        insertCollaborator(grandchild, orphanedUser, "NO_ACCESS");
        // Same user, outside the pruned subtree: untouched.
        insertCollaborator(outside, orphanedUser, "NO_ACCESS");

        int deleted = pruneOrphanedBreakpoints(root);

        assertThat(deleted).isEqualTo(3);
        // keptUser's positive grant and the breakpoint it justifies both survive.
        assertThat(collaboratorUserIds(root)).containsExactly(keptUser);
        assertThat(collaboratorUserIds(grandchild)).containsExactly(keptUser);
        // orphanedUser's rows inside the subtree are gone; the one outside it is not.
        assertThat(collaboratorUserIds(child)).isEmpty();
        assertThat(collaboratorUserIds(outside)).containsExactly(orphanedUser);
    }

    /**
     * Runs {@code DocumentCollaboratorRepository#deleteNoAccessInSubtreeForUser} verbatim: the
     * statement pairs a recursive subtree walk with DELETE ... USING, so a syntax or scope
     * mistake is invisible to the H2-backed service tests.
     */
    @Test
    void deleteNoAccessInSubtreeForUser_removesOnlyThatUsersBreakpointsInSubtree() throws SQLException {
        UUID root = UUID.randomUUID();
        UUID child = UUID.randomUUID();
        UUID outside = UUID.randomUUID();
        UUID leavingUser = insertUser();
        UUID otherUser = insertUser();

        insertDoc(root, null, "RESTRICTED", null, false, false);
        insertDoc(child, root, "RESTRICTED", null, false, false);
        insertDoc(outside, null, "RESTRICTED", null, false, false);

        insertCollaborator(root, leavingUser, "NO_ACCESS");
        insertCollaborator(child, leavingUser, "NO_ACCESS");
        insertCollaborator(child, otherUser, "NO_ACCESS");
        insertCollaborator(outside, leavingUser, "NO_ACCESS");

        int deleted = deleteNoAccessInSubtreeForUser(root, leavingUser);

        assertThat(deleted).isEqualTo(2);
        assertThat(collaboratorUserIds(root)).isEmpty();
        assertThat(collaboratorUserIds(child)).containsExactly(otherUser);
        assertThat(collaboratorUserIds(outside)).containsExactly(leavingUser);
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

    private List<UUID> collaboratorUserIdsWithAncestorGrant(UUID documentId) {
        return namedQuery(DocumentCollaboratorRepository.COLLABORATOR_ANCESTOR_GRANT_SQL, "documentId", documentId);
    }

    private int pruneOrphanedBreakpoints(UUID subtreeRootId) {
        return namedQueryTemplate()
                .update(
                        DocumentCollaboratorRepository.PRUNE_ORPHANED_BREAKPOINTS_SQL,
                        new MapSqlParameterSource("subtreeRootId", subtreeRootId));
    }

    private int deleteNoAccessInSubtreeForUser(UUID subtreeRootId, UUID userId) {
        MapSqlParameterSource params = new MapSqlParameterSource("subtreeRootId", subtreeRootId);
        params.addValue("userId", userId);
        return namedQueryTemplate().update(DocumentCollaboratorRepository.DELETE_NO_ACCESS_IN_SUBTREE_SQL, params);
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
