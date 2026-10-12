package com.nextdocs.api.document.repository;

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
import java.util.List;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Runs the real Flyway migrations against PostgreSQL and checks the page icon
 * and cover columns. The rest of the suite builds tables through Hibernate with
 * Flyway disabled, so {@code V17__document_icon_cover.sql} never executes there.
 */
class DocumentIconCoverMigrationPostgresTest {

    private Connection connection;
    private String schema;
    private UUID userId;

    @BeforeEach
    void setUp() throws Exception {
        String url = PostgresTestSupport.resolveUrl();
        String username = PostgresTestSupport.resolveUsername();
        String password = PostgresTestSupport.resolvePassword();

        connection = PostgresTestSupport.connect(url, username, password);

        schema = "iconcoverpg_" + UUID.randomUUID().toString().replace("-", "");
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
    void migration_addsNullableIconAndCoverColumns() throws SQLException {
        assertThat(columnNames("documents"))
                .contains("icon_type", "icon_value", "icon_color", "cover_type", "cover_value", "cover_position");
    }

    @Test
    void iconAndCover_roundTrip() throws SQLException {
        UUID documentId = insertDocument();
        try (PreparedStatement stmt = connection.prepareStatement(
                "UPDATE documents SET icon_type = 'BUILTIN', icon_value = ?, icon_color = 'blue', "
                        + "cover_type = 'LINK', cover_value = ?, cover_position = 0.25 WHERE id = ?")) {
            stmt.setString(1, "home");
            stmt.setString(2, "https://example.com/cover.png");
            stmt.setObject(3, documentId);
            assertThat(stmt.executeUpdate()).isOne();
        }

        try (PreparedStatement stmt =
                connection.prepareStatement("SELECT icon_type, icon_value, icon_color, cover_type, cover_value, "
                        + "cover_position FROM documents WHERE id = ?")) {
            stmt.setObject(1, documentId);
            try (ResultSet rs = stmt.executeQuery()) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getString(1)).isEqualTo("BUILTIN");
                assertThat(rs.getString(2)).isEqualTo("home");
                assertThat(rs.getString(3)).isEqualTo("blue");
                assertThat(rs.getString(4)).isEqualTo("LINK");
                assertThat(rs.getString(5)).isEqualTo("https://example.com/cover.png");
                assertThat(rs.getDouble(6)).isEqualTo(0.25);
            }
        }
    }

    @Test
    void checkConstraints_rejectBadTypesAndPositions() throws SQLException {
        UUID documentId = insertDocument();

        // Unknown icon type.
        assertThatThrownBy(() -> updateIcon(documentId, "TABLER", "home")).isInstanceOf(SQLException.class);
        // Type without a value, and a value without a type.
        assertThatThrownBy(() -> updateIcon(documentId, "EMOJI", null)).isInstanceOf(SQLException.class);
        assertThatThrownBy(() -> updateIconValueOnly(documentId, "📝")).isInstanceOf(SQLException.class);
        // Unknown cover type and an out-of-range focal offset.
        assertThatThrownBy(() -> updateCover(documentId, "EMOJI", "x", 0.5)).isInstanceOf(SQLException.class);
        assertThatThrownBy(() -> updateCover(documentId, "LINK", "https://example.com/c.png", 1.5))
                .isInstanceOf(SQLException.class);
    }

    @Test
    void iconColor_onlySurvivesOnABuiltinIcon() throws SQLException {
        UUID documentId = insertDocument();

        // A key outside the palette must never reach a renderer.
        assertThatThrownBy(() -> updateIconColor(documentId, "BUILTIN", "home", "rainbow"))
                .isInstanceOf(SQLException.class);
        // A color on an icon that cannot render one is rejected.
        assertThatThrownBy(() -> updateIconColor(documentId, "EMOJI", "📝", "blue"))
                .isInstanceOf(SQLException.class);
        // Including the icon-less row, where a plain `icon_type = 'BUILTIN'` would
        // evaluate to NULL and hand the CHECK a pass.
        assertThatThrownBy(() -> updateIconColor(documentId, null, null, "blue"))
                .isInstanceOf(SQLException.class);

        // The legal shape writes.
        updateIconColor(documentId, "BUILTIN", "home", "blue");
        assertThat(iconColor(documentId)).isEqualTo("blue");

        // Swapping the builtin icon for an emoji while leaving the color behind is
        // the stale row this constraint exists to catch.
        assertThatThrownBy(() -> updateIcon(documentId, "EMOJI", "📝")).isInstanceOf(SQLException.class);
        updateIconAndClearColor(documentId, "EMOJI", "📝");
        assertThat(iconColor(documentId)).isNull();
    }

    private List<String> columnNames(String table) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = ?")) {
            stmt.setString(1, schema);
            stmt.setString(2, table);
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
            stmt.setString(2, "iconcoverpg-" + id + "@example.com");
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
            stmt.setString(3, "Icon doc " + id);
            stmt.setBytes(4, "seed".getBytes(StandardCharsets.UTF_8));
            stmt.executeUpdate();
            return id;
        }
    }

    private void updateIcon(UUID documentId, String type, String value) throws SQLException {
        try (PreparedStatement stmt =
                connection.prepareStatement("UPDATE documents SET icon_type = ?, icon_value = ? WHERE id = ?")) {
            stmt.setString(1, type);
            stmt.setString(2, value);
            stmt.setObject(3, documentId);
            stmt.executeUpdate();
        }
    }

    private void updateIconValueOnly(UUID documentId, String value) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement("UPDATE documents SET icon_value = ? WHERE id = ?")) {
            stmt.setString(1, value);
            stmt.setObject(2, documentId);
            stmt.executeUpdate();
        }
    }

    private void updateIconColor(UUID documentId, String type, String value, String color) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "UPDATE documents SET icon_type = ?, icon_value = ?, icon_color = ? WHERE id = ?")) {
            stmt.setString(1, type);
            stmt.setString(2, value);
            stmt.setString(3, color);
            stmt.setObject(4, documentId);
            stmt.executeUpdate();
        }
    }

    private void updateIconAndClearColor(UUID documentId, String type, String value) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "UPDATE documents SET icon_type = ?, icon_value = ?, icon_color = NULL WHERE id = ?")) {
            stmt.setString(1, type);
            stmt.setString(2, value);
            stmt.setObject(3, documentId);
            stmt.executeUpdate();
        }
    }

    private String iconColor(UUID documentId) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement("SELECT icon_color FROM documents WHERE id = ?")) {
            stmt.setObject(1, documentId);
            try (ResultSet rs = stmt.executeQuery()) {
                assertThat(rs.next()).isTrue();
                return rs.getString(1);
            }
        }
    }

    private void updateCover(UUID documentId, String type, String value, double position) throws SQLException {
        try (PreparedStatement stmt = connection.prepareStatement(
                "UPDATE documents SET cover_type = ?, cover_value = ?, cover_position = ? WHERE id = ?")) {
            stmt.setString(1, type);
            stmt.setString(2, value);
            stmt.setDouble(3, position);
            stmt.setObject(4, documentId);
            stmt.executeUpdate();
        }
    }
}
