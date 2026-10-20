package com.nextdocs.api.space.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.nextdocs.api.PostgresTestSupport;
import com.nextdocs.api.document.repository.DocumentRepository;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

/**
 * Migration and permission-resolution test against real PostgreSQL.
 *
 * <p>The space grant lives inside {@code resolve_effective_access}/{@code resolve_trash_access},
 * which no H2 test can execute, so the SQL rules that make a space safe are pinned here: the
 * space is the outermost grant (document ownership, collaborator rows, NO_ACCESS breakpoints,
 * and link grants all still win), a PUBLIC grant requires workspace membership, and the V24
 * migration applies on top of a database that already holds V1..V23 data without touching a
 * single existing page.
 */
class SpacePermissionMigrationPostgresTest {

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
        migrateTo(null);
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

    /** Builds a throwaway schema, optionally stopping at a target version, and uses it. */
    private void migrateTo(String target) throws SQLException {
        if (schema != null) {
            try (Statement stmt = connection.createStatement()) {
                stmt.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
            }
        }
        schema = "pgtest_" + UUID.randomUUID().toString().replace("-", "");
        var config = Flyway.configure()
                .dataSource(url, username, password)
                .schemas(schema)
                .defaultSchema(schema)
                .createSchemas(true)
                .locations("classpath:db/migration");
        if (target != null) {
            config = config.target(MigrationVersion.fromVersion(target));
        }
        config.load().migrate();
        try (Statement stmt = connection.createStatement()) {
            stmt.execute("SET search_path TO " + schema);
        }
    }

    /** Applies the remaining migrations to the schema currently in use. */
    private void migrateFurther() {
        Flyway.configure()
                .dataSource(url, username, password)
                .schemas(schema)
                .defaultSchema(schema)
                .createSchemas(false)
                .locations("classpath:db/migration")
                .load()
                .migrate();
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
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'MEMBER', now())")) {
            stmt.setObject(1, workspaceId);
            stmt.setObject(2, userId);
            stmt.executeUpdate();
        }
        return workspaceId;
    }

    private UUID insertWorkspace() throws SQLException {
        UUID workspaceId = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, 'NextDocs', now(), now())")) {
            stmt.setObject(1, workspaceId);
            stmt.executeUpdate();
        }
        return workspaceId;
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
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO space_members (space_id, user_id, access_level, created_at, updated_at) "
                        + "VALUES (?, ?, ?, now(), now())")) {
            stmt.setObject(1, spaceId);
            stmt.setObject(2, userId);
            stmt.setString(3, accessLevel);
            stmt.executeUpdate();
        }
    }

    private void insertDoc(UUID id, UUID ownerId, UUID parentId, UUID spaceId, String linkMode, String linkLevel)
            throws SQLException {
        insertDoc(id, ownerId, parentId, spaceId, linkMode, linkLevel, false);
    }

    private void insertDoc(
            UUID id, UUID ownerId, UUID parentId, UUID spaceId, String linkMode, String linkLevel, boolean trashed)
            throws SQLException {
        String sql = "INSERT INTO documents (id, user_id, parent_id, space_id, title, yjs_state, general_access_mode, "
                + "link_access_level, sibling_order_key, deleted_at, created_at, updated_at) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now(), now())";
        try (PreparedStatement stmt = connection.prepareStatement(sql)) {
            stmt.setObject(1, id);
            stmt.setObject(2, ownerId);
            stmt.setObject(3, parentId);
            stmt.setObject(4, spaceId);
            stmt.setString(5, "Page " + id);
            stmt.setBytes(6, "seed".getBytes(StandardCharsets.UTF_8));
            stmt.setString(7, linkMode == null ? "RESTRICTED" : linkMode);
            stmt.setString(8, linkLevel == null ? "VIEW" : linkLevel);
            stmt.setString(9, parentId != null ? "a" + id.toString().substring(0, 4) : null);
            stmt.setTimestamp(10, trashed ? Timestamp.from(Instant.now()) : null);
            stmt.executeUpdate();
        }
    }

    /** A page as it exists before V24: there is no space_id column yet. */
    private void insertLegacyDoc(UUID id, UUID ownerId) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO documents (id, user_id, title, yjs_state, created_at, updated_at) "
                        + "VALUES (?, ?, 'Legacy Page', ?, now(), now())")) {
            stmt.setObject(1, id);
            stmt.setObject(2, ownerId);
            stmt.setBytes(3, "seed".getBytes(StandardCharsets.UTF_8));
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

    private String resolveAccess(UUID userId, UUID docId) throws SQLException {
        return scalar("SELECT resolve_effective_access(?, ?)", userId, docId);
    }

    private String resolveTrashAccess(UUID userId, UUID docId) throws SQLException {
        return scalar("SELECT resolve_trash_access(?, ?)", userId, docId);
    }

    private Boolean hasPositiveAncestorGrant(UUID userId, UUID docId) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement("SELECT has_positive_ancestor_grant(?, ?)")) {
            stmt.setObject(1, userId);
            stmt.setObject(2, docId);
            try (ResultSet rs = stmt.executeQuery()) {
                return rs.next() ? rs.getBoolean(1) : null;
            }
        }
    }

    private String scalarOne(String sql, UUID argument) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(sql)) {
            stmt.setObject(1, argument);
            try (ResultSet rs = stmt.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        }
    }

    private String scalar(String sql, UUID first, UUID second) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(sql)) {
            stmt.setObject(1, first);
            stmt.setObject(2, second);
            try (ResultSet rs = stmt.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        }
    }

    @Test
    void customSpace_onlyListedMembersResolveALevel() throws SQLException {
        UUID owner = insertUser();
        UUID member = insertUser();
        UUID stranger = insertUser();
        UUID workspaceId = insertWorkspaceAndMember(owner);
        insertWorkspaceMember(workspaceId, member);
        insertWorkspaceMember(workspaceId, stranger);

        UUID spaceId = insertSpace(workspaceId, "CUSTOM", "VIEW");
        insertSpaceMember(spaceId, member, "EDIT");

        UUID rootPage = UUID.randomUUID();
        UUID child = UUID.randomUUID();
        insertDoc(rootPage, owner, null, spaceId, null, null);
        insertDoc(child, owner, rootPage, null, null, null);

        assertThat(resolveAccess(member, rootPage)).isEqualTo("EDIT");
        // Descendants inherit the space through the ordinary parent chain.
        assertThat(resolveAccess(member, child)).isEqualTo("EDIT");
        // A workspace member who is not listed gets nothing from a Custom space.
        assertThat(resolveAccess(stranger, rootPage)).isNull();
        assertThat(resolveAccess(stranger, child)).isNull();
    }

    @Test
    void publicSpace_everyWorkspaceMemberInheritsEveryoneLevel() throws SQLException {
        UUID owner = insertUser();
        UUID member = insertUser();
        UUID outsider = insertUser();
        UUID workspaceId = insertWorkspaceAndMember(owner);
        insertWorkspaceMember(workspaceId, member);

        UUID spaceId = insertSpace(workspaceId, "PUBLIC", "COMMENT");
        insertSpaceMember(spaceId, member, "EDIT");

        UUID page = UUID.randomUUID();
        insertDoc(page, owner, null, spaceId, null, null);

        assertThat(resolveAccess(owner, page)).isEqualTo("OWNER");
        // A listed member keeps their own level rather than the everyone-else grant.
        assertThat(resolveAccess(member, page)).isEqualTo("EDIT");
        // Any other member of the workspace gets the everyone-else level.
        assertThat(resolveAccess(insertUserInWorkspace(workspaceId), page)).isEqualTo("COMMENT");
        // Someone outside the workspace gets nothing, whatever the space mode says.
        assertThat(resolveAccess(outsider, page)).isNull();
    }

    private UUID insertUserInWorkspace(UUID workspaceId) throws SQLException {
        UUID userId = insertUser();
        insertWorkspaceMember(workspaceId, userId);
        return userId;
    }

    private void insertWorkspaceMember(UUID workspaceId, UUID userId) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'MEMBER', now())")) {
            stmt.setObject(1, workspaceId);
            stmt.setObject(2, userId);
            stmt.executeUpdate();
        }
    }

    @Test
    void documentGrantsBeatsSpaceGrant_everyTime() throws SQLException {
        UUID owner = insertUser();
        UUID member = insertUser();
        UUID workspaceId = insertWorkspaceAndMember(owner);
        insertWorkspaceMember(workspaceId, member);

        UUID spaceId = insertSpace(workspaceId, "CUSTOM", "VIEW");
        insertSpaceMember(spaceId, member, "EDIT");

        UUID plainPage = UUID.randomUUID();
        UUID downgradedPage = UUID.randomUUID();
        UUID revokedPage = UUID.randomUUID();
        UUID linkPage = UUID.randomUUID();
        insertDoc(plainPage, owner, null, spaceId, null, null);
        insertDoc(downgradedPage, owner, null, spaceId, null, null);
        insertDoc(revokedPage, owner, null, spaceId, null, null);
        insertDoc(linkPage, owner, null, spaceId, "ANYONE_WITH_LINK", "VIEW");

        insertCollaborator(downgradedPage, member, "VIEW");
        insertCollaborator(revokedPage, member, "NO_ACCESS");

        assertThat(resolveAccess(member, plainPage)).isEqualTo("EDIT");
        // A document-level collaborator row is closer than the space, in both directions.
        assertThat(resolveAccess(member, downgradedPage)).isEqualTo("VIEW");
        // A NO_ACCESS breakpoint still revokes what the space would have granted.
        assertThat(resolveAccess(member, revokedPage)).isNull();
        // A link grant on the page itself also wins over the space grant.
        assertThat(resolveAccess(member, linkPage)).isEqualTo("VIEW");
        // The page's own owner is always OWNER, space or not.
        assertThat(resolveAccess(owner, plainPage)).isEqualTo("OWNER");
        // The breakpoint on a space's root page has the space grant to shadow, so the
        // sharing API treats it as meaningful instead of deleting it as orphaned.
        assertThat(hasPositiveAncestorGrant(member, revokedPage)).isTrue();
    }

    @Test
    void spaceGrant_neverLeaksToAnonymousShareLinks() throws SQLException {
        UUID owner = insertUser();
        UUID workspaceId = insertWorkspaceAndMember(owner);
        UUID spaceId = insertSpace(workspaceId, "PUBLIC", "EDIT");
        UUID page = UUID.randomUUID();
        insertDoc(page, owner, null, spaceId, null, null);

        assertThat(scalarOne("SELECT resolve_public_access(?)", page)).isNull();
    }

    @Test
    void trashScope_resolvesSpaceGrantSoOwnersCanRestore() throws SQLException {
        UUID owner = insertUser();
        UUID member = insertUser();
        UUID stranger = insertUser();
        UUID workspaceId = insertWorkspaceAndMember(owner);
        insertWorkspaceMember(workspaceId, member);
        insertWorkspaceMember(workspaceId, stranger);

        UUID spaceId = insertSpace(workspaceId, "CUSTOM", "VIEW");
        insertSpaceMember(spaceId, owner, "OWNER");
        insertSpaceMember(spaceId, member, "EDIT");

        UUID page = UUID.randomUUID();
        insertDoc(page, owner, null, spaceId, null, null, true);

        assertThat(resolveAccess(member, page)).isNull();
        assertThat(resolveTrashAccess(member, page)).isEqualTo("EDIT");
        assertThat(resolveTrashAccess(owner, page)).isEqualTo("OWNER");
        assertThat(resolveTrashAccess(stranger, page)).isNull();
    }

    @Test
    void hasPositiveAncestorGrant_countsASpaceGrant() throws SQLException {
        UUID owner = insertUser();
        UUID member = insertUser();
        UUID workspaceId = insertWorkspaceAndMember(owner);
        insertWorkspaceMember(workspaceId, member);

        UUID spaceId = insertSpace(workspaceId, "CUSTOM", "VIEW");
        insertSpaceMember(spaceId, member, "EDIT");

        UUID page = UUID.randomUUID();
        UUID child = UUID.randomUUID();
        insertDoc(page, owner, null, spaceId, null, null);
        insertDoc(child, owner, page, null, null, null);
        insertCollaborator(child, member, "NO_ACCESS");

        // Without the space branch this would answer false, and the sharing API could
        // never clear the breakpoint it just wrote.
        assertThat(hasPositiveAncestorGrant(member, child)).isTrue();
    }

    @Test
    void spaceId_isRefusedOnNestedPages() throws SQLException {
        UUID owner = insertUser();
        UUID workspaceId = insertWorkspaceAndMember(owner);
        UUID spaceId = insertSpace(workspaceId, "CUSTOM", "VIEW");
        UUID root = UUID.randomUUID();
        UUID child = UUID.randomUUID();
        insertDoc(root, owner, null, spaceId, null, null);

        assertThatThrownBy(() -> insertDoc(child, owner, root, spaceId, null, null))
                .isInstanceOf(SQLException.class)
                .hasMessageContaining("chk_documents_space_root");
    }

    /**
     * Runs {@link com.nextdocs.api.document.repository.DocumentRepository#SPACE_PAGES_SQL}
     * and its count query verbatim: a page the caller cannot open must not appear in the
     * space's root listing, or the sidebar would offer a page that answers 404.
     */
    @Test
    void spaceListingQuery_hidesPagesTheCallerCannotOpen() throws SQLException {
        UUID owner = insertUser();
        UUID member = insertUser();
        UUID workspaceId = insertWorkspaceAndMember(owner);
        insertWorkspaceMember(workspaceId, member);

        UUID spaceId = insertSpace(workspaceId, "CUSTOM", "VIEW");
        insertSpaceMember(spaceId, member, "EDIT");

        UUID visible = UUID.randomUUID();
        UUID revoked = UUID.randomUUID();
        insertDoc(visible, owner, null, spaceId, null, null);
        insertDoc(revoked, owner, null, spaceId, null, null);
        insertCollaborator(revoked, member, "NO_ACCESS");

        var params = new MapSqlParameterSource().addValue("userId", member).addValue("spaceId", spaceId);
        var jdbc = new NamedParameterJdbcTemplate(new SingleConnectionDataSource(connection, true));

        assertThat(jdbc.query(
                        DocumentRepository.SPACE_PAGES_SQL, params, (rs, rowNum) -> rs.getObject("id", UUID.class)))
                .containsExactly(visible);
        assertThat(jdbc.queryForObject(DocumentRepository.SPACE_PAGES_COUNT_SQL, params, Long.class))
                .isEqualTo(1L);
    }

    @Test
    void migrationsApplyOnTopOfV23_andLeaveExistingPagesUntouched() throws Exception {
        migrateTo("23");

        UUID owner = insertUser();
        UUID workspaceId = insertWorkspace();
        insertWorkspaceMember(workspaceId, owner);
        UUID privatePage = UUID.randomUUID();
        insertLegacyDoc(privatePage, owner);

        // Same schema, next version: exactly what an existing install goes through.
        migrateFurther();

        try (Statement stmt = connection.createStatement();
                ResultSet rs = stmt.executeQuery("SELECT count(*) FROM spaces")) {
            rs.next();
            assertThat(rs.getInt(1)).isZero();
        }
        try (PreparedStatement stmt = connection.prepareStatement("SELECT space_id FROM documents WHERE id = ?")) {
            stmt.setObject(1, privatePage);
            try (ResultSet rs = stmt.executeQuery()) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getObject(1)).isNull();
            }
        }
    }
}
