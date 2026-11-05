package com.nextdocs.api.comment.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.nextdocs.api.PostgresTestSupport;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Runs the real Flyway migrations against PostgreSQL and inspects the comment
 * schema. The main suite creates tables through Hibernate on H2, so
 * {@code V38__comments.sql} never executes there; a typo in the DDL would only
 * surface when a self-hoster's database migrates.
 */
class CommentMigrationPostgresTest {

    private Connection connection;
    private String schema;
    private UUID ownerId;
    private UUID userId;
    private UUID workspaceId;

    @BeforeEach
    void setUp() throws Exception {
        String url = PostgresTestSupport.resolveUrl();
        String username = PostgresTestSupport.resolveUsername();
        String password = PostgresTestSupport.resolvePassword();

        connection = PostgresTestSupport.connect(url, username, password);

        schema = "commentpg_" + UUID.randomUUID().toString().replace("-", "");
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
        // The document belongs to a different account so the author-deletion test
        // does not cascade the whole document away with the user.
        ownerId = insertUser();
        userId = insertUser();
        workspaceId = insertWorkspace();
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
    void migration_createsTheThreeCommentTables() throws SQLException {
        assertThat(columnFacts("comment_threads"))
                .containsOnlyKeys(
                        "id",
                        "document_id",
                        "created_by_user_id",
                        "resolved",
                        "resolved_by_user_id",
                        "resolved_by_user_key",
                        "resolved_by_name",
                        "resolved_at",
                        "created_at",
                        "updated_at");
        assertThat(columnFacts("comments"))
                .containsOnlyKeys(
                        "id",
                        "thread_id",
                        "author_user_id",
                        "author_user_key",
                        "author_name",
                        "body",
                        "created_at",
                        "updated_at");
        assertThat(columnFacts("comment_reactions"))
                .containsOnlyKeys("id", "comment_id", "user_id", "emoji", "created_at");

        // The service writes bodies as JSON text, so the column must not be a JSONB
        // type Hibernate would not validate against the H2 test schema.
        assertThat(typeOf("comments", "body")).isEqualTo("text");
    }

    @Test
    void indexes_existForTheReadPathsAndPurge() throws SQLException {
        List<String> definitions = indexDefinitions();

        assertThat(definitions)
                .anyMatch(def -> def.contains("idx_comment_threads_document_created")
                        && def.contains("(document_id, created_at, id)"))
                .anyMatch(def ->
                        def.contains("idx_comments_thread_created") && def.contains("(thread_id, created_at, id)"))
                .anyMatch(def -> def.contains("uq_comment_reactions_comment_user_emoji")
                        && def.contains("UNIQUE")
                        && def.contains("(comment_id, user_id, emoji)"));
    }

    @Test
    void documentDelete_cascadesThreadsCommentsAndReactions() throws SQLException {
        UUID documentId = insertDocument();
        UUID threadId = insertThread(documentId, false, null, null);
        UUID commentId = insertComment(threadId, userId);
        insertReaction(commentId, "👍");

        assertThat(countWhere("comment_threads", "document_id", documentId)).isEqualTo(1);
        assertThat(countWhere("comments", "thread_id", threadId)).isEqualTo(1);
        assertThat(countWhere("comment_reactions", "comment_id", commentId)).isEqualTo(1);

        try (PreparedStatement stmt = connection.prepareStatement("DELETE FROM documents WHERE id = ?")) {
            stmt.setObject(1, documentId);
            stmt.executeUpdate();
        }

        assertThat(countWhere("comment_threads", "document_id", documentId)).isZero();
        assertThat(countWhere("comments", "thread_id", threadId)).isZero();
        assertThat(countWhere("comment_reactions", "comment_id", commentId)).isZero();
    }

    @Test
    void resolutionCheck_rejectsHalfWrittenResolutions() throws SQLException {
        UUID documentId = insertDocument();

        assertThatThrownBy(() -> insertThread(documentId, false, OffsetDateTimeNow(), null))
                .isInstanceOf(SQLException.class);
        assertThatThrownBy(() -> insertThread(documentId, true, null, "Alice")).isInstanceOf(SQLException.class);
    }

    @Test
    void reaction_isUniquePerCommentUserAndEmoji() throws SQLException {
        UUID documentId = insertDocument();
        UUID threadId = insertThread(documentId, false, null, null);
        UUID commentId = insertComment(threadId, userId);

        insertReaction(commentId, "👍");

        assertThatThrownBy(() -> insertReaction(commentId, "👍")).isInstanceOf(SQLException.class);
    }

    @Test
    void authorFk_isSetNullWhenTheAccountIsDeleted() throws SQLException {
        UUID documentId = insertDocument();
        UUID threadId = insertThread(documentId, true, OffsetDateTimeNow(), "Alice");
        UUID commentId = insertComment(threadId, userId);

        try (PreparedStatement stmt = connection.prepareStatement("DELETE FROM users WHERE id = ?")) {
            stmt.setObject(1, userId);
            stmt.executeUpdate();
        }

        try (PreparedStatement stmt =
                connection.prepareStatement("SELECT author_user_id, author_user_key FROM comments WHERE id = ?")) {
            stmt.setObject(1, commentId);
            try (ResultSet rs = stmt.executeQuery()) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getObject(1)).isNull();
                assertThat(rs.getObject(2, UUID.class)).isNotNull();
            }
        }
    }

    // --- fixtures ---------------------------------------------------------------

    private UUID insertUser() throws SQLException {
        UUID id = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) "
                        + "VALUES (?, ?, 'hash', 'Test User', now(), now())")) {
            stmt.setObject(1, id);
            stmt.setString(2, "commentpg-" + id + "@example.com");
            stmt.executeUpdate();
        }
        return id;
    }

    private UUID insertWorkspace() throws SQLException {
        UUID id = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, 'Test Workspace', now(), now())")) {
            stmt.setObject(1, id);
            stmt.executeUpdate();
        }
        return id;
    }

    private UUID insertDocument() throws SQLException {
        UUID id = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO documents (id, user_id, workspace_id, title, yjs_state, general_access_mode, link_access_level, "
                        + "link_inherit_blocked, created_at, updated_at) "
                        + "VALUES (?, ?, ?, ?, ?, 'RESTRICTED', 'VIEW', false, now(), now())")) {
            stmt.setObject(1, id);
            stmt.setObject(2, ownerId);
            stmt.setObject(3, workspaceId);
            stmt.setString(4, "Comment doc " + id);
            stmt.setBytes(5, "seed".getBytes(StandardCharsets.UTF_8));
            stmt.executeUpdate();
        }
        return id;
    }

    private UUID insertThread(UUID documentId, boolean resolved, java.time.OffsetDateTime resolvedAt, String name)
            throws SQLException {
        UUID id = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO comment_threads (id, document_id, created_by_user_id, resolved, resolved_by_user_id, "
                        + "resolved_by_name, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?)")) {
            stmt.setObject(1, id);
            stmt.setObject(2, documentId);
            stmt.setObject(3, userId);
            stmt.setBoolean(4, resolved);
            stmt.setObject(5, resolved ? userId : null);
            stmt.setString(6, name);
            stmt.setObject(7, resolvedAt);
            stmt.executeUpdate();
        }
        return id;
    }

    private UUID insertComment(UUID threadId, UUID authorKey) throws SQLException {
        UUID id = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO comments (id, thread_id, author_user_id, author_user_key, author_name, body) "
                        + "VALUES (?, ?, ?, ?, 'Test User', '[{\"type\":\"paragraph\"}]')")) {
            stmt.setObject(1, id);
            stmt.setObject(2, threadId);
            stmt.setObject(3, authorKey);
            stmt.setObject(4, authorKey);
            stmt.executeUpdate();
        }
        return id;
    }

    private void insertReaction(UUID commentId, String emoji) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO comment_reactions (id, comment_id, user_id, emoji) VALUES (?, ?, ?, ?)")) {
            stmt.setObject(1, UUID.randomUUID());
            stmt.setObject(2, commentId);
            stmt.setObject(3, userId);
            stmt.setString(4, emoji);
            stmt.executeUpdate();
        }
    }

    private int countWhere(String table, String column, UUID id) throws SQLException {
        try (PreparedStatement stmt =
                connection.prepareStatement("SELECT count(*) FROM " + table + " WHERE " + column + " = ?")) {
            stmt.setObject(1, id);
            try (ResultSet rs = stmt.executeQuery()) {
                rs.next();
                return rs.getInt(1);
            }
        }
    }

    private Map<String, String> columnFacts(String table) throws SQLException {
        return columnFactsWithDefaults(table).entrySet().stream()
                .collect(java.util.stream.Collectors.toMap(
                        Map.Entry::getKey, entry -> entry.getValue()[0], (a, b) -> a));
    }

    private Map<String, String[]> columnFactsWithDefaults(String table) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "SELECT column_name, data_type, is_nullable FROM information_schema.columns "
                        + "WHERE table_schema = ? AND table_name = ?")) {
            stmt.setString(1, schema);
            stmt.setString(2, table);
            try (ResultSet rs = stmt.executeQuery()) {
                Map<String, String[]> facts = new LinkedHashMap<>();
                while (rs.next()) {
                    facts.put(rs.getString(1), new String[] {rs.getString(3), rs.getString(2)});
                }
                return facts;
            }
        }
    }

    private String typeOf(String table, String column) throws SQLException {
        return columnFactsWithDefaults(table).get(column)[1];
    }

    private List<String> indexDefinitions() throws SQLException {
        try (PreparedStatement stmt =
                connection.prepareStatement("SELECT indexdef FROM pg_indexes WHERE schemaname = ? AND tablename IN "
                        + "('comment_threads', 'comments', 'comment_reactions')")) {
            stmt.setString(1, schema);
            try (ResultSet rs = stmt.executeQuery()) {
                List<String> definitions = new ArrayList<>();
                while (rs.next()) {
                    definitions.add(rs.getString(1));
                }
                return definitions;
            }
        }
    }

    private static java.time.OffsetDateTime OffsetDateTimeNow() {
        return java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC);
    }
}
