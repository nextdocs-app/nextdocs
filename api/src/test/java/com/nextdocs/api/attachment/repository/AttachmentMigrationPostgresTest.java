package com.nextdocs.api.attachment.repository;

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
 * Runs the real Flyway migrations against PostgreSQL and inspects the resulting
 * {@code attachments} schema. The rest of the suite builds tables through Hibernate with
 * Flyway disabled, so {@code V15__create_attachments_table.sql} never executes there — a
 * typo in the DDL would only surface when a self-hoster's database migrates.
 */
class AttachmentMigrationPostgresTest {

    private Connection connection;
    private String schema;
    private UUID userId;

    @BeforeEach
    void setUp() throws Exception {
        String url = PostgresTestSupport.resolveUrl();
        String username = PostgresTestSupport.resolveUsername();
        String password = PostgresTestSupport.resolvePassword();

        // No skip path: an unreachable database fails this test. The migration DDL
        // runs nowhere else, so a skip would be a hole in coverage.
        connection = PostgresTestSupport.connect(url, username, password);

        schema = "attachpg_" + UUID.randomUUID().toString().replace("-", "");
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
        userId = insertUser();
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
    void migration_createsAttachmentsTableWithExpectedColumns() throws SQLException {
        assertThat(columnNames())
                .containsExactlyInAnyOrder(
                        "id",
                        "document_id",
                        "uploaded_by",
                        "file_name",
                        "content_type",
                        "size_bytes",
                        "storage_key",
                        "sha256",
                        "created_at");
    }

    @Test
    void storageKey_isUniqueAndDocumentForeignKeyCascades() throws SQLException {
        UUID documentId = insertDocument();
        UUID attachmentId = UUID.randomUUID();
        String storageKey = documentId + "/" + attachmentId;
        insertAttachment(attachmentId, documentId, storageKey);

        // The UUID primary key defaults server-side, so constructing without one must work.
        UUID generated = insertAttachmentWithoutId(documentId, documentId + "/" + UUID.randomUUID());
        assertThat(generated).isNotNull();

        assertThatThrownBy(() -> insertAttachment(UUID.randomUUID(), documentId, storageKey))
                .isInstanceOf(SQLException.class);

        try (PreparedStatement stmt = connection.prepareStatement("DELETE FROM documents WHERE id = ?")) {
            stmt.setObject(1, documentId);
            stmt.executeUpdate();
        }
        assertThat(countAttachmentsForDocument(documentId)).isZero();
    }

    @Test
    void documentId_hasIndexForLookupAndDelete() throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "SELECT indexdef FROM pg_indexes WHERE schemaname = ? AND tablename = 'attachments'")) {
            stmt.setString(1, schema);
            try (ResultSet rs = stmt.executeQuery()) {
                List<String> definitions = new ArrayList<>();
                while (rs.next()) {
                    definitions.add(rs.getString(1));
                }
                assertThat(definitions)
                        .anyMatch(def -> def.contains("idx_attachments_document_id"))
                        .anyMatch(def -> def.contains("uq_attachments_storage_key"));
            }
        }
    }

    @Test
    void attachments_everyColumnIsNotNullableWithServerSideDefaults() throws SQLException {
        Map<String, String[]> columns = columnFacts("attachments");

        assertThat(columns)
                .containsOnlyKeys(
                        "id",
                        "document_id",
                        "uploaded_by",
                        "file_name",
                        "content_type",
                        "size_bytes",
                        "storage_key",
                        "sha256",
                        "created_at");
        for (Map.Entry<String, String[]> entry : columns.entrySet()) {
            assertThat(entry.getValue()[0]).as("%s nullability", entry.getKey()).isEqualTo("NO");
        }
        // Server-side defaults matter: the id must be mintable without the application
        // supplying one, and created_at must land even on a direct SQL insert.
        assertThat(columns.get("id")[1]).contains("gen_random_uuid");
        assertThat(columns.get("created_at")[1]).contains("now()");
        assertThat(columns.get("size_bytes")[1])
                .as("size_bytes must come from the upload")
                .isNull();
    }

    @Test
    void attachmentUsage_isKeyedByNotNullableUserAndCounter() throws SQLException {
        Map<String, String[]> columns = columnFacts("attachment_usage");

        assertThat(columns).containsOnlyKeys("user_id", "used_bytes", "updated_at");
        for (Map.Entry<String, String[]> entry : columns.entrySet()) {
            assertThat(entry.getValue()[0]).as("%s nullability", entry.getKey()).isEqualTo("NO");
        }
        assertThat(columns.get("used_bytes")[1]).contains("0");
        assertThat(columns.get("updated_at")[1]).contains("now()");
    }

    @Test
    void attachmentUsage_deletingTheUserRemovesTheCounterRow() throws SQLException {
        try (Statement stmt = connection.createStatement()) {
            stmt.execute("INSERT INTO attachment_usage (user_id, used_bytes) VALUES ('" + userId + "', 5)");
        }

        try (PreparedStatement stmt = connection.prepareStatement("DELETE FROM users WHERE id = ?")) {
            stmt.setObject(1, userId);
            stmt.executeUpdate();
        }

        try (Statement stmt = connection.createStatement();
                ResultSet rs = stmt.executeQuery("SELECT count(*) FROM attachment_usage")) {
            rs.next();
            assertThat(rs.getInt(1)).isZero();
        }
    }

    private Map<String, String[]> columnFacts(String table) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "SELECT column_name, is_nullable, column_default FROM information_schema.columns "
                        + "WHERE table_schema = ? AND table_name = ?")) {
            stmt.setString(1, schema);
            stmt.setString(2, table);
            try (ResultSet rs = stmt.executeQuery()) {
                Map<String, String[]> facts = new LinkedHashMap<>();
                while (rs.next()) {
                    facts.put(rs.getString(1), new String[] {rs.getString(2), rs.getString(3)});
                }
                return facts;
            }
        }
    }

    private List<String> columnNames() throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = 'attachments'")) {
            stmt.setString(1, schema);
            try (ResultSet rs = stmt.executeQuery()) {
                List<String> columns = new ArrayList<>();
                while (rs.next()) {
                    columns.add(rs.getString(1));
                }
                return columns;
            }
        }
    }

    private UUID insertUser() throws SQLException {
        UUID id = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) "
                        + "VALUES (?, ?, 'hash', 'Test User', now(), now())")) {
            stmt.setObject(1, id);
            stmt.setString(2, "attachpg-" + id + "@example.com");
            stmt.executeUpdate();
        }
        return id;
    }

    private UUID insertDocument() throws SQLException {
        UUID id = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO documents (id, user_id, title, yjs_state, general_access_mode, link_access_level, "
                        + "link_inherit_blocked, created_at, updated_at) "
                        + "VALUES (?, ?, ?, ?, 'RESTRICTED', 'VIEW', false, now(), now())")) {
            stmt.setObject(1, id);
            stmt.setObject(2, userId);
            stmt.setString(3, "Attachment doc " + id);
            stmt.setBytes(4, "seed".getBytes(StandardCharsets.UTF_8));
            stmt.executeUpdate();
        }
        return id;
    }

    private void insertAttachment(UUID attachmentId, UUID documentId, String storageKey) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO attachments (id, document_id, uploaded_by, file_name, content_type, size_bytes, "
                        + "storage_key, sha256) VALUES (?, ?, ?, 'file.bin', 'application/octet-stream', 3, ?, ?)")) {
            stmt.setObject(1, attachmentId);
            stmt.setObject(2, documentId);
            stmt.setObject(3, userId);
            stmt.setString(4, storageKey);
            stmt.setString(5, "0".repeat(64));
            stmt.executeUpdate();
        }
    }

    private UUID insertAttachmentWithoutId(UUID documentId, String storageKey) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO attachments (document_id, uploaded_by, file_name, content_type, size_bytes, "
                        + "storage_key, sha256) VALUES (?, ?, 'file.bin', 'application/octet-stream', 3, ?, ?) "
                        + "RETURNING id")) {
            stmt.setObject(1, documentId);
            stmt.setObject(2, userId);
            stmt.setString(3, storageKey);
            stmt.setString(4, "0".repeat(64));
            try (ResultSet rs = stmt.executeQuery()) {
                rs.next();
                return (UUID) rs.getObject(1);
            }
        }
    }

    private int countAttachmentsForDocument(UUID documentId) throws SQLException {
        try (PreparedStatement stmt =
                connection.prepareStatement("SELECT count(*) FROM attachments WHERE document_id = ?")) {
            stmt.setObject(1, documentId);
            try (ResultSet rs = stmt.executeQuery()) {
                rs.next();
                return rs.getInt(1);
            }
        }
    }
}
