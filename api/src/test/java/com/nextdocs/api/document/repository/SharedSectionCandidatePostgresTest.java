package com.nextdocs.api.document.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nextdocs.api.PostgresTestSupport;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.LinkedHashMap;
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
 * The Shared section candidate query against real PostgreSQL.
 *
 * <p>It calls {@code resolve_effective_access}, which only exists in the Flyway schema, so
 * the mocked service tests cannot pin the predicate that decides what reaches the section.
 * These tests cover the single-home rule (a page already surfaced by a readable parent or a
 * browsable space must not appear again), the one-document variant used by document reads,
 * and the plan over a tenant far larger than the caller's reach.
 */
class SharedSectionCandidatePostgresTest {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();
    private static final long MAX_DOCUMENT_SCAN_ROWS = 500;

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
    void candidateQueriesApplyTheSingleHomeRuleAndAgreeWithEachOther() throws SQLException {
        UUID owner = insertUser();
        UUID viewer = insertUser();
        UUID workspaceId = insertWorkspaceAndMember(owner);
        insertWorkspaceMember(workspaceId, viewer);

        UUID publicSpaceId = insertSpace(workspaceId, "PUBLIC", "VIEW");
        UUID publicSpaceRoot = insertDoc(owner, workspaceId, null, publicSpaceId, "RESTRICTED", null);
        // The grant makes the page a candidate; the browsable PUBLIC space removes it
        // again. Without the space branch in the visibility predicate it would render
        // in both the space and Shared.
        insertGrant(workspaceId, publicSpaceRoot, viewer, null, "ALLOW", "EDIT");

        UUID customSpaceId = insertSpace(workspaceId, "CUSTOM", "VIEW");
        UUID customSpaceRoot = insertDoc(owner, workspaceId, null, customSpaceId, "RESTRICTED", null);
        // A CUSTOM space the viewer cannot browse leaves the granted root with no other
        // home, so it belongs in Shared.
        insertGrant(workspaceId, customSpaceRoot, viewer, null, "ALLOW", "EDIT");

        UUID browsableCustomSpaceId = insertSpace(workspaceId, "CUSTOM", "VIEW");
        insertSpaceMember(browsableCustomSpaceId, viewer, "VIEW");
        UUID browsableCustomSpaceRoot = insertDoc(owner, workspaceId, null, browsableCustomSpaceId, "RESTRICTED", null);
        // A CUSTOM space the viewer does browse surfaces the root in its space listing,
        // so the grant must not also put it in Shared.
        insertGrant(workspaceId, browsableCustomSpaceRoot, viewer, null, "ALLOW", "EDIT");

        UUID archivedSpaceId = insertSpace(workspaceId, "CUSTOM", "VIEW");
        insertSpaceMember(archivedSpaceId, viewer, "VIEW");
        UUID archivedSpaceRoot = insertDoc(owner, workspaceId, null, archivedSpaceId, "RESTRICTED", null);
        insertGrant(workspaceId, archivedSpaceRoot, viewer, null, "ALLOW", "EDIT");
        archiveSpace(archivedSpaceId);

        UUID workspaceMembersRoot = insertDoc(owner, workspaceId, null, null, "WORKSPACE_MEMBERS", null);

        UUID collaboratorRoot = insertDoc(owner, workspaceId, null, null, "RESTRICTED", null);
        insertGrant(workspaceId, collaboratorRoot, viewer, null, "ALLOW", "VIEW");

        UUID groupId = insertGroup(workspaceId);
        insertGroupMember(groupId, viewer);
        UUID groupSharedRoot = insertDoc(owner, workspaceId, null, null, "RESTRICTED", null);
        insertGrant(workspaceId, groupSharedRoot, null, groupId, "ALLOW", "COMMENT");

        UUID ownedSharedRoot = insertDoc(viewer, workspaceId, null, null, "WORKSPACE_MEMBERS", null);
        UUID ownedPrivateRoot = insertDoc(viewer, workspaceId, null, null, "RESTRICTED", null);
        UUID ownedGrantedRoot = insertDoc(viewer, workspaceId, null, null, "RESTRICTED", null);
        insertGrant(workspaceId, ownedGrantedRoot, owner, null, "ALLOW", "VIEW");

        UUID unreadableParent = insertDoc(owner, workspaceId, null, null, "RESTRICTED", null);
        UUID floatedChild = insertDoc(owner, workspaceId, unreadableParent, null, "RESTRICTED", null);
        insertGrant(workspaceId, floatedChild, viewer, null, "ALLOW", "VIEW");

        UUID readableParent = insertDoc(owner, workspaceId, null, null, "RESTRICTED", null);
        insertGrant(workspaceId, readableParent, viewer, null, "ALLOW", "VIEW");
        UUID nestedChild = insertDoc(owner, workspaceId, readableParent, null, "RESTRICTED", null);
        // The child is readable, but its readable parent already surfaces it.
        insertGrant(workspaceId, nestedChild, viewer, null, "ALLOW", "EDIT");

        UUID trashedGranted = insertDoc(owner, workspaceId, null, null, "RESTRICTED", null, true);
        insertGrant(workspaceId, trashedGranted, viewer, null, "ALLOW", "VIEW");

        Map<UUID, String> expected = new LinkedHashMap<>();
        expected.put(customSpaceRoot, "EDIT");
        expected.put(workspaceMembersRoot, "VIEW");
        // An archived space is no longer in navigation, so its root has no browsable
        // container and comes back to Shared until the space is restored. The archive
        // also caps the granted level at VIEW.
        expected.put(archivedSpaceRoot, "VIEW");
        expected.put(collaboratorRoot, "VIEW");
        expected.put(groupSharedRoot, "COMMENT");
        expected.put(ownedSharedRoot, "OWNER");
        expected.put(ownedGrantedRoot, "OWNER");
        expected.put(floatedChild, "VIEW");
        // The granted root itself is a Shared entry; only its child is surfaced by it.
        expected.put(readableParent, "VIEW");

        Map<UUID, String> listed = listCandidates(viewer);
        assertThat(listed).containsExactlyInAnyOrderEntriesOf(expected);

        for (Map.Entry<UUID, String> entry : expected.entrySet()) {
            assertThat(singleCandidate(viewer, entry.getKey()))
                    .as("single-document placement for %s", entry.getKey())
                    .isEqualTo(entry.getValue());
        }
        for (UUID excluded :
                List.of(publicSpaceRoot, browsableCustomSpaceRoot, ownedPrivateRoot, nestedChild, trashedGranted)) {
            assertThat(singleCandidate(viewer, excluded))
                    .as("single-document placement for excluded %s", excluded)
                    .isNull();
        }
    }

    @Test
    void candidateQueryReportsOwnershipFromTheResolvedLevel() throws SQLException {
        UUID owner = insertUser();
        UUID viewer = insertUser();
        UUID workspaceId = insertWorkspaceAndMember(owner);
        insertWorkspaceMember(workspaceId, viewer);

        // The viewer holds OWNER on a page they do not own, and its parent is
        // unreadable, so the page floats in their Shared section.
        UUID unreadableParent = insertDoc(owner, workspaceId, null, null, "RESTRICTED", null);
        UUID ownerLevelFloatedChild = insertDoc(owner, workspaceId, unreadableParent, null, "RESTRICTED", null);
        insertGrant(workspaceId, ownerLevelFloatedChild, viewer, null, "ALLOW", "OWNER");

        UUID ownerLevelSharedRoot = insertDoc(owner, workspaceId, null, null, "RESTRICTED", null);
        insertGrant(workspaceId, ownerLevelSharedRoot, viewer, null, "ALLOW", "OWNER");

        // The creator's own root at the same level reads the same way.
        UUID ownedRoot = insertDoc(viewer, workspaceId, null, null, "RESTRICTED", null);
        insertGrant(workspaceId, ownedRoot, owner, null, "ALLOW", "OWNER");

        CandidateRow floated = singleCandidateRow(viewer, ownerLevelFloatedChild);
        assertThat(floated).isNotNull();
        assertThat(floated.accessLevel()).isEqualTo("OWNER");
        assertThat(floated.parentId()).isEqualTo(unreadableParent);
        assertThat(floated.owner()).as("OWNER is a level now").isTrue();

        CandidateRow sharedRoot = singleCandidateRow(viewer, ownerLevelSharedRoot);
        assertThat(sharedRoot).isNotNull();
        assertThat(sharedRoot.accessLevel()).isEqualTo("OWNER");
        assertThat(sharedRoot.owner()).as("OWNER is a level now").isTrue();

        CandidateRow owned = singleCandidateRow(viewer, ownedRoot);
        assertThat(owned).isNotNull();
        assertThat(owned.accessLevel()).isEqualTo("OWNER");
        assertThat(owned.owner()).isTrue();

        assertThat(listCandidateRows(viewer))
                .containsEntry(ownerLevelFloatedChild, new CandidateRow(unreadableParent, "OWNER", true))
                .containsEntry(ownerLevelSharedRoot, new CandidateRow(null, "OWNER", true))
                .containsEntry(ownedRoot, new CandidateRow(null, "OWNER", true));

        // DocumentRepository maps these rows by position, so the order is part of the contract.
        Object[] raw = rawCandidateRow(viewer, ownerLevelFloatedChild);
        assertThat(raw[6]).as("access_level rides at index 6").isEqualTo("OWNER");
        assertThat(raw[7]).as("ownership rides at index 7").isEqualTo(true);
    }

    private Object[] rawCandidateRow(UUID userId, UUID documentId) {
        var params = new MapSqlParameterSource().addValue("userId", userId).addValue("documentId", documentId);
        var jdbc = new NamedParameterJdbcTemplate(new SingleConnectionDataSource(connection, true));
        return jdbc.queryForObject(DocumentRepository.SHARED_SECTION_CANDIDATE_SQL, params, (rs, rowNum) -> {
            Object[] values = new Object[8];
            for (int i = 0; i < values.length; i++) {
                values[i] = rs.getObject(i + 1);
            }
            return values;
        });
    }

    @Test
    void candidateQueryDoesNotReadTheRestOfTheWorkspace() throws Exception {
        UUID owner = insertUser();
        UUID viewer = insertUser();
        UUID workspaceId = insertWorkspaceAndMember(owner);
        insertWorkspaceMember(workspaceId, viewer);

        UUID sharedRoot = insertDoc(owner, workspaceId, null, null, "RESTRICTED", null);
        insertGrant(workspaceId, sharedRoot, viewer, null, "ALLOW", "VIEW");
        UUID ownedRoot = insertDoc(viewer, workspaceId, null, null, "WORKSPACE_MEMBERS", null);
        insertUnrelatedRoots(owner, workspaceId, 1_500);

        try (Statement stmt = connection.createStatement()) {
            // The planner must not fall back to a sequential scan just because the
            // fixture is small enough for one on a laptop.
            stmt.execute("SET enable_seqscan = OFF");
        }
        var params = new MapSqlParameterSource().addValue("userId", viewer);
        var jdbc = new NamedParameterJdbcTemplate(new SingleConnectionDataSource(connection, true));

        String plan = jdbc.queryForObject(
                "EXPLAIN (ANALYZE, FORMAT JSON) " + DocumentRepository.SHARED_SECTION_CANDIDATES_SQL,
                params,
                String.class);
        JsonNode root = OBJECT_MAPPER.readTree(plan);
        assertDocumentScansStayNarrow(root.get(0).get("Plan"));

        assertThat(listCandidates(viewer)).containsOnlyKeys(sharedRoot, ownedRoot);
    }

    @Test
    void candidateBranchesUseThePartialScanIndexes() throws Exception {
        UUID owner = insertUser();
        UUID viewer = insertUser();
        UUID workspaceId = insertWorkspaceAndMember(owner);
        insertWorkspaceMember(workspaceId, viewer);
        insertDoc(viewer, workspaceId, null, null, "WORKSPACE_MEMBERS", null);

        try (Statement stmt = connection.createStatement()) {
            // idx_documents_workspace_audience is partial on deleted_at IS NULL, so a
            // branch only reaches it when it repeats that predicate itself; the
            // candidate_pages CTE filter is applied too late.
            stmt.execute("SET enable_seqscan = OFF");
        }
        var params = new MapSqlParameterSource().addValue("userId", viewer);
        var jdbc = new NamedParameterJdbcTemplate(new SingleConnectionDataSource(connection, true));

        String plan = String.join(
                "\n",
                jdbc.queryForList("EXPLAIN " + DocumentRepository.SHARED_SECTION_CANDIDATES_SQL, params, String.class));

        assertThat(plan).contains("idx_documents_workspace_audience");
    }

    private void assertDocumentScansStayNarrow(JsonNode node) {
        if ("documents".equals(node.path("Relation Name").asText()) && node.has("Actual Rows")) {
            assertThat(node.get("Actual Rows").asLong())
                    .as("rows read from documents by %s", node.path("Node Type").asText())
                    .isLessThan(MAX_DOCUMENT_SCAN_ROWS);
        }
        for (JsonNode child : node.path("Plans")) {
            assertDocumentScansStayNarrow(child);
        }
    }

    private record CandidateRow(UUID parentId, String accessLevel, boolean owner) {}

    private Map<UUID, CandidateRow> listCandidateRows(UUID userId) {
        var params = new MapSqlParameterSource().addValue("userId", userId);
        var jdbc = new NamedParameterJdbcTemplate(new SingleConnectionDataSource(connection, true));
        Map<UUID, CandidateRow> rows = new LinkedHashMap<>();
        jdbc.query(DocumentRepository.SHARED_SECTION_CANDIDATES_SQL, params, rs -> {
            rows.put(
                    rs.getObject("id", UUID.class),
                    new CandidateRow(
                            rs.getObject("parent_id", UUID.class),
                            rs.getString("access_level"),
                            rs.getBoolean("owner")));
        });
        return rows;
    }

    private CandidateRow singleCandidateRow(UUID userId, UUID documentId) {
        var params = new MapSqlParameterSource().addValue("userId", userId).addValue("documentId", documentId);
        var jdbc = new NamedParameterJdbcTemplate(new SingleConnectionDataSource(connection, true));
        List<CandidateRow> rows = jdbc.query(
                DocumentRepository.SHARED_SECTION_CANDIDATE_SQL,
                params,
                (rs, rowNum) -> new CandidateRow(
                        rs.getObject("parent_id", UUID.class), rs.getString("access_level"), rs.getBoolean("owner")));
        return rows.isEmpty() ? null : rows.get(0);
    }

    private Map<UUID, String> listCandidates(UUID userId) {
        var params = new MapSqlParameterSource().addValue("userId", userId);
        var jdbc = new NamedParameterJdbcTemplate(new SingleConnectionDataSource(connection, true));
        Map<UUID, String> rows = new LinkedHashMap<>();
        jdbc.query(DocumentRepository.SHARED_SECTION_CANDIDATES_SQL, params, rs -> {
            rows.put(rs.getObject("id", UUID.class), rs.getString("access_level"));
        });
        return rows;
    }

    private String singleCandidate(UUID userId, UUID documentId) {
        var params = new MapSqlParameterSource().addValue("userId", userId).addValue("documentId", documentId);
        var jdbc = new NamedParameterJdbcTemplate(new SingleConnectionDataSource(connection, true));
        List<String> levels = jdbc.query(
                DocumentRepository.SHARED_SECTION_CANDIDATE_SQL, params, (rs, rowNum) -> rs.getString("access_level"));
        return levels.isEmpty() ? null : levels.get(0);
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
        return id;
    }

    private UUID insertWorkspaceAndMember(UUID userId) throws SQLException {
        UUID workspaceId = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, 'NextDocs', now(), now())")) {
            stmt.setObject(1, workspaceId);
            stmt.executeUpdate();
        }
        insertWorkspaceMember(workspaceId, userId);
        return workspaceId;
    }

    private void insertWorkspaceMember(UUID workspaceId, UUID userId) throws SQLException {
        try (PreparedStatement stmt =
                connection.prepareStatement("INSERT INTO workspace_members (workspace_id, user_id, role, created_at) "
                        + "VALUES (?, ?, 'MEMBER', now())")) {
            stmt.setObject(1, workspaceId);
            stmt.setObject(2, userId);
            stmt.executeUpdate();
        }
    }

    private UUID insertSpace(UUID workspaceId, String accessMode, String everyoneLevel) throws SQLException {
        UUID spaceId = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO spaces (id, workspace_id, name, access_mode, everyone_access_level, created_at, updated_at) "
                        + "VALUES (?, ?, 'Engineering', ?, ?, now(), now())")) {
            stmt.setObject(1, spaceId);
            stmt.setObject(2, workspaceId);
            stmt.setString(3, accessMode);
            stmt.setString(4, everyoneLevel);
            stmt.executeUpdate();
        }
        return spaceId;
    }

    private void insertSpaceMember(UUID spaceId, UUID userId, String accessLevel) throws SQLException {
        try (PreparedStatement stmt =
                connection.prepareStatement("INSERT INTO space_members (space_id, user_id, access_level, created_at, "
                        + "updated_at) VALUES (?, ?, ?, now(), now())")) {
            stmt.setObject(1, spaceId);
            stmt.setObject(2, userId);
            stmt.setString(3, accessLevel);
            stmt.executeUpdate();
        }
    }

    private void archiveSpace(UUID spaceId) throws SQLException {
        try (PreparedStatement stmt =
                connection.prepareStatement("UPDATE spaces SET archived_at = now() WHERE id = ?")) {
            stmt.setObject(1, spaceId);
            stmt.executeUpdate();
        }
    }

    private UUID insertGroup(UUID workspaceId) throws SQLException {
        UUID groupId = UUID.randomUUID();
        try (PreparedStatement stmt =
                connection.prepareStatement("INSERT INTO workspace_groups (id, workspace_id, name) VALUES (?, ?, ?)")) {
            stmt.setObject(1, groupId);
            stmt.setObject(2, workspaceId);
            stmt.setString(3, "Group " + groupId);
            stmt.executeUpdate();
        }
        return groupId;
    }

    private void insertGroupMember(UUID groupId, UUID userId) throws SQLException {
        try (PreparedStatement stmt =
                connection.prepareStatement("INSERT INTO workspace_group_members (group_id, user_id) VALUES (?, ?)")) {
            stmt.setObject(1, groupId);
            stmt.setObject(2, userId);
            stmt.executeUpdate();
        }
    }

    private void insertGrant(
            UUID workspaceId, UUID documentId, UUID userId, UUID groupId, String effect, String accessLevel)
            throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO access_grants (workspace_id, document_id, user_id, group_id, effect, access_level) "
                        + "VALUES (?, ?, ?, ?, ?, ?)")) {
            stmt.setObject(1, workspaceId);
            stmt.setObject(2, documentId);
            stmt.setObject(3, userId);
            stmt.setObject(4, groupId);
            stmt.setString(5, effect);
            stmt.setString(6, accessLevel);
            stmt.executeUpdate();
        }
    }

    private UUID insertDoc(
            UUID ownerId, UUID workspaceId, UUID parentId, UUID spaceId, String workspaceAccessMode, String title)
            throws SQLException {
        return insertDoc(ownerId, workspaceId, parentId, spaceId, workspaceAccessMode, title, false);
    }

    private UUID insertDoc(
            UUID ownerId,
            UUID workspaceId,
            UUID parentId,
            UUID spaceId,
            String workspaceAccessMode,
            String title,
            boolean trashed)
            throws SQLException {
        UUID id = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO documents (id, created_by, workspace_id, parent_id, space_id, title, "
                        + "workspace_access_mode, general_access_mode, link_access_level, sibling_order_key, "
                        + "deleted_at, created_at, updated_at) "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?, 'RESTRICTED', 'VIEW', ?, ?, now(), now())")) {
            stmt.setObject(1, id);
            stmt.setObject(2, ownerId);
            stmt.setObject(3, workspaceId);
            stmt.setObject(4, parentId);
            stmt.setObject(5, spaceId);
            stmt.setString(6, title != null ? title : "Page " + id);
            stmt.setString(7, workspaceAccessMode);
            String siblingOrderKey =
                    parentId != null || spaceId != null ? "a" + id.toString().replace("-", "") : null;
            stmt.setString(8, siblingOrderKey);
            stmt.setTimestamp(9, trashed ? java.sql.Timestamp.from(java.time.Instant.now()) : null);
            stmt.executeUpdate();
        }
        // V50: a standalone root's creator owns it through a real grant row.
        if (parentId == null && spaceId == null) {
            insertGrant(workspaceId, id, ownerId, null, "ALLOW", "OWNER");
        }
        return id;
    }

    private void insertUnrelatedRoots(UUID ownerId, UUID workspaceId, int count) throws SQLException {
        boolean autoCommit = connection.getAutoCommit();
        connection.setAutoCommit(false);
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO documents (id, created_by, workspace_id, title, workspace_access_mode, "
                        + "general_access_mode, link_access_level, created_at, updated_at) "
                        + "VALUES (?, ?, ?, ?, 'RESTRICTED', 'RESTRICTED', 'VIEW', now(), now())")) {
            for (int i = 0; i < count; i++) {
                stmt.setObject(1, UUID.randomUUID());
                stmt.setObject(2, ownerId);
                stmt.setObject(3, workspaceId);
                stmt.setString(4, "Unrelated " + i);
                stmt.addBatch();
            }
            stmt.executeBatch();
            connection.commit();
        } finally {
            connection.setAutoCommit(autoCommit);
        }
    }
}
