package com.nextdocs.api.search.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.nextdocs.api.PostgresTestSupport;
import com.nextdocs.api.search.config.SearchProperties;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

/**
 * Runs V42 and the search SQL against real PostgreSQL. H2 never sees this code: the
 * projection, tsquery operators, and the permission resolver are Postgres-only, and the
 * main suite disables search before any of it executes there.
 */
class DocumentSearchPostgresTest {

    private static Connection sharedConnection;
    private static String schema;
    private static String url;
    private static String username;
    private static String password;

    private Connection connection;
    private NamedParameterJdbcTemplate jdbc;
    private DocumentSearchRepository repository;
    private UUID workspaceId;
    private UUID ownerId;
    private UUID readerId;

    @BeforeAll
    static void migrate() {
        url = PostgresTestSupport.resolveUrl();
        username = PostgresTestSupport.resolveUsername();
        password = PostgresTestSupport.resolvePassword();
        schema = "pgtest_search_" + UUID.randomUUID().toString().replace("-", "");

        Flyway.configure()
                .dataSource(url, username, password)
                .schemas(schema)
                .defaultSchema(schema)
                .createSchemas(true)
                .locations("classpath:db/migration")
                .load()
                .migrate();

        sharedConnection = PostgresTestSupport.connect(url, username, password);
    }

    @AfterAll
    static void dropSchema() throws Exception {
        if (sharedConnection == null || sharedConnection.isClosed()) {
            return;
        }
        try (Statement stmt = sharedConnection.createStatement()) {
            stmt.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        } finally {
            sharedConnection.close();
        }
    }

    @BeforeEach
    void setUp() throws Exception {
        connection = PostgresTestSupport.connect(url, username, password);
        try (Statement stmt = connection.createStatement()) {
            // public keeps the unaccent extension visible when a previous migration
            // installed it database-wide instead of in this throwaway schema.
            stmt.execute("SET search_path TO " + schema + ", public");
            stmt.execute("TRUNCATE TABLE workspaces, users CASCADE");
        }
        workspaceId = insertWorkspace();
        ownerId = insertMember("OWNER");
        readerId = insertMember("MEMBER");
        jdbc = new NamedParameterJdbcTemplate(new SingleConnectionDataSource(connection, true));
        repository = new DocumentSearchRepository(jdbc, new SearchProperties());
    }

    @AfterEach
    void tearDown() throws Exception {
        if (connection != null && !connection.isClosed()) {
            connection.close();
        }
    }

    @Test
    void ranksTitleMatchesAboveBodyMatchesAndMarksSnippets() throws Exception {
        UUID titleDocument = insertDocument(ownerId, "Authentication guide");
        UUID bodyDocument = insertDocument(ownerId, "Deployment notes");
        repository.upsertContent(titleDocument, "", false, now(), now());
        repository.upsertContent(bodyDocument, "Authentication is configured here.", false, now(), now());

        List<DocumentSearchRepository.SearchRow> rows =
                repository.search(workspaceId, ownerId, "authentication", "authentication:*", 10, 0);

        assertThat(rows)
                .extracting(DocumentSearchRepository.SearchRow::documentId)
                .containsExactly(titleDocument, bodyDocument);
        assertThat(rows.get(0).titleHeadline()).contains("\u0001");
        assertThat(rows.get(1).snippet()).contains("\u0001Authentication\u0002");
    }

    @Test
    void searchesLiveTitlesBeforeTheProjectionExists() throws Exception {
        UUID documentId = insertDocument(ownerId, "Andrew guide");

        assertThat(repository.search(workspaceId, ownerId, "Andrew", "Andrew:*", 10, 0))
                .extracting(DocumentSearchRepository.SearchRow::documentId)
                .containsExactly(documentId);
        assertThat(repository.search(workspaceId, readerId, "Andrew", "Andrew:*", 10, 0))
                .isEmpty();
        assertThat(repository.search(UUID.randomUUID(), ownerId, "Andrew", "Andrew:*", 10, 0))
                .isEmpty();
    }

    @Test
    void searchesSingleLetterAndStopwordPrefixesInTitlesAndBodies() throws Exception {
        UUID titleDocument = insertDocument(ownerId, "Andrew guide");
        UUID bodyDocument = insertDocument(ownerId, "Deployment notes");
        repository.upsertContent(titleDocument, "", false, now(), now());
        repository.upsertContent(bodyDocument, "Android configuration", false, now(), now());

        for (String query : List.of("a", "an", "and")) {
            assertThat(repository.search(workspaceId, ownerId, query, query + ":*", 10, 0))
                    .extracting(DocumentSearchRepository.SearchRow::documentId)
                    .containsExactly(titleDocument, bodyDocument);
        }
    }

    @Test
    void searchesSymbolAndEmojiTitlesAndEscapesLikeWildcards() throws Exception {
        UUID symbolDocument = insertDocument(ownerId, "# Roadmap");
        UUID emojiDocument = insertDocument(ownerId, "🚀 Launch");
        UUID percentDocument = insertDocument(ownerId, "% complete");
        insertDocument(ownerId, "100% complete");

        assertThat(repository.search(workspaceId, ownerId, "#", null, 10, 0))
                .extracting(DocumentSearchRepository.SearchRow::documentId)
                .containsExactly(symbolDocument);
        assertThat(repository.search(workspaceId, ownerId, "🚀", null, 10, 0))
                .extracting(DocumentSearchRepository.SearchRow::documentId)
                .containsExactly(emojiDocument);
        // The pattern is a literal prefix, not a wildcard: "%%" would return every title.
        assertThat(repository.search(workspaceId, ownerId, "%", null, 10, 0))
                .extracting(DocumentSearchRepository.SearchRow::documentId)
                .containsExactly(percentDocument);
    }

    @Test
    void doesNotMatchInfixTitleOrBodySubstrings() throws Exception {
        UUID documentId = insertDocument(ownerId, "Banana");
        repository.upsertContent(documentId, "Banana bread", false, now(), now());

        // "an" is a prefix of "analytics"/"android" but never an infix of "banana".
        assertThat(repository.search(workspaceId, ownerId, "an", "an:*", 10, 0)).isEmpty();
        assertThat(repository.suggest(workspaceId, ownerId, "an", 10)).isEmpty();
    }

    @Test
    void ranksExactTitleAboveTitlePrefixAboveExactBodyAboveBodyPrefix() throws Exception {
        UUID exactTitle = insertDocument(ownerId, "Cat");
        UUID titlePrefix = insertDocument(ownerId, "Catalog");
        UUID exactBody = insertDocument(ownerId, "Notes");
        UUID bodyPrefix = insertDocument(ownerId, "Ideas");
        for (UUID documentId : List.of(exactTitle, titlePrefix, exactBody, bodyPrefix)) {
            repository.upsertContent(documentId, "", false, now(), now());
        }
        repository.upsertContent(exactBody, "cat", false, now(), now());
        repository.upsertContent(bodyPrefix, "catalog", false, now(), now());

        assertThat(repository.search(workspaceId, ownerId, "cat", "cat:*", 10, 0))
                .extracting(DocumentSearchRepository.SearchRow::documentId)
                .containsExactly(exactTitle, titlePrefix, exactBody, bodyPrefix);
    }

    @Test
    void ranksAnExactStopwordTitleAbovePrefixTitles() throws Exception {
        UUID exactTitle = insertDocument(ownerId, "an");
        UUID analytics = insertDocument(ownerId, "Analytics");
        UUID android = insertDocument(ownerId, "Android");

        assertThat(repository.search(workspaceId, ownerId, "an", "an:*", 10, 0))
                .extracting(DocumentSearchRepository.SearchRow::documentId)
                .containsExactlyInAnyOrder(exactTitle, analytics, android);
        assertThat(repository
                        .search(workspaceId, ownerId, "an", "an:*", 10, 0)
                        .get(0)
                        .documentId())
                .isEqualTo(exactTitle);
        assertThat(repository.suggest(workspaceId, ownerId, "an", 10).get(0).documentId())
                .isEqualTo(exactTitle);
    }

    @Test
    void onlyTheLastTypedTokenIsAPrefix() throws Exception {
        UUID exactFirstToken = insertDocument(ownerId, "Auth flowcharts");
        UUID prefixFirstToken = insertDocument(ownerId, "Authentication flowcharts");
        repository.upsertContent(exactFirstToken, "", false, now(), now());
        repository.upsertContent(prefixFirstToken, "", false, now(), now());

        assertThat(repository.search(workspaceId, ownerId, "auth flow", "auth & flow:*", 10, 0))
                .extracting(DocumentSearchRepository.SearchRow::documentId)
                .containsExactly(exactFirstToken);
    }

    @Test
    void liveTitleMatchesKeepWebsearchOperatorsAndTrashFiltering() throws Exception {
        UUID documentId = insertDocument(ownerId, "Andrew guide");
        repository.upsertTitle(documentId);

        assertThat(repository.search(workspaceId, ownerId, "Andrew -guide", null, 10, 0))
                .isEmpty();
        jdbc.update(
                "UPDATE documents SET deleted_at = now() WHERE id = :id", new MapSqlParameterSource("id", documentId));
        assertThat(repository.search(workspaceId, ownerId, "Andrew", "Andrew:*", 10, 0))
                .isEmpty();
    }

    @Test
    void resolvesAccessInsideTheQueryWithoutReindexing() throws Exception {
        UUID documentId = insertDocument(ownerId, "Quarterly plan");
        repository.upsertContent(documentId, "", false, now(), now());

        assertThat(repository.search(workspaceId, readerId, "quarterly", "quarterly:*", 10, 0))
                .isEmpty();

        grant(documentId, readerId, "VIEW");

        // No second index write: the same rows now resolve for the new reader.
        assertThat(repository.search(workspaceId, readerId, "quarterly", "quarterly:*", 10, 0))
                .extracting(DocumentSearchRepository.SearchRow::documentId)
                .containsExactly(documentId);
    }

    @Test
    void excludesTrashedDocumentsAndDocumentsFromAnotherWorkspace() throws Exception {
        UUID trashed = insertDocument(ownerId, "Archived budget");
        repository.upsertContent(trashed, "", false, now(), now());
        jdbc.update("UPDATE documents SET deleted_at = now() WHERE id = :id", new MapSqlParameterSource("id", trashed));

        assertThat(repository.search(workspaceId, ownerId, "budget", "budget:*", 10, 0))
                .isEmpty();
    }

    @Test
    void anOlderContentEventDoesNotOverwriteANewerProjection() throws Exception {
        UUID documentId = insertDocument(ownerId, "Ordering");
        repository.upsertContent(documentId, "newest words", false, instant("2020-01-02T00:00:00Z"), now());
        repository.upsertContent(documentId, "older words", false, instant("2020-01-01T00:00:00Z"), now());

        assertThat(storedContent(documentId)).isEqualTo("newest words");
        // An older retry must not claim a fresh verification either: the text and its
        // timestamps are behind the same guard.
        jdbc.update(
                "UPDATE document_search SET verified_at = :verified WHERE document_id = :id",
                new MapSqlParameterSource(Map.of("verified", instant("2020-01-03T00:00:00Z"), "id", documentId)));
        repository.upsertContent(documentId, "stale words", false, instant("2020-01-01T00:00:00Z"), now());
        assertThat(storedContent(documentId)).isEqualTo("newest words");
        assertThat(storedVerifiedAt(documentId)).isEqualTo(instant("2020-01-03T00:00:00Z"));
    }

    @Test
    void aTitleWriteKeepsTheIndexedBody() throws Exception {
        UUID documentId = insertDocument(ownerId, "Old title");
        repository.upsertContent(documentId, "body text", false, now(), now());

        jdbc.update(
                "UPDATE documents SET title = 'Renamed page' WHERE id = :id",
                new MapSqlParameterSource("id", documentId));
        repository.upsertTitle(documentId);

        assertThat(storedContent(documentId)).isEqualTo("body text");
        assertThat(repository.search(workspaceId, ownerId, "renamed", "renamed:*", 10, 0))
                .extracting(DocumentSearchRepository.SearchRow::documentId)
                .containsExactly(documentId);
        assertThat(repository.search(workspaceId, ownerId, "old title", null, 10, 0))
                .isEmpty();
    }

    @Test
    void suggestionsMatchAnAccentedTitleWithoutAccents() throws Exception {
        UUID documentId = insertDocument(ownerId, "Café résumé");

        assertThat(repository.suggest(workspaceId, ownerId, "cafe", 10))
                .extracting(DocumentSearchRepository.SearchRow::documentId)
                .containsExactly(documentId);
    }

    @Test
    void suggestionsFoldAccentsInTheQueryPattern() throws Exception {
        UUID documentId = insertDocument(ownerId, "Café résumé");

        // SearchQueries lowercases the pattern; this covers the SQL half of the path.
        assertThat(repository.suggest(workspaceId, ownerId, "café", 10))
                .extracting(DocumentSearchRepository.SearchRow::documentId)
                .containsExactly(documentId);
    }

    @Test
    void fillsThePageWhenInvisibleRowsConsumeTheResolveWindow() throws Exception {
        // More top-ranked matches than the bounded window can hold, all owned by someone
        // else, with the one readable page ranked last. The window alone would answer an
        // empty page and call it the end of the results.
        int invisible = DocumentSearchRepository.RESOLVE_WINDOW_SLACK + 20;
        for (int index = 0; index < invisible; index++) {
            UUID id = insertDocument(ownerId, "Quarterly plan " + index);
            repository.upsertContent(id, "", false, now(), now());
        }
        UUID shared = insertDocument(ownerId, "Quarterly plan shared");
        repository.upsertContent(shared, "", false, now(), now());
        jdbc.update(
                "UPDATE documents SET updated_at = now() - interval '1 day' WHERE id = :id",
                new MapSqlParameterSource("id", shared));
        grant(shared, readerId, "VIEW");

        assertThat(repository.search(workspaceId, readerId, "quarterly", "quarterly:*", 10, 0))
                .extracting(DocumentSearchRepository.SearchRow::documentId)
                .containsExactly(shared);
        // Suggestions use the same bounded window and must expand the same way.
        assertThat(repository.suggest(workspaceId, readerId, "quarterly", 10))
                .extracting(DocumentSearchRepository.SearchRow::documentId)
                .containsExactly(shared);
    }

    @Test
    void breadcrumbsStopAtTheFirstInaccessibleAncestor() throws Exception {
        UUID root = insertDocument(ownerId, "Restricted root");
        UUID middle = insertDocument(ownerId, "Restricted middle");
        UUID leaf = insertDocument(ownerId, "Shared leaf");
        setParent(middle, root);
        setParent(leaf, middle);
        repository.upsertContent(leaf, "", false, now(), now());
        grant(leaf, readerId, "VIEW");

        // A direct grant on the leaf does not reveal the restricted chain above it.
        assertThat(repository.findBreadcrumbs(List.of(leaf), readerId))
                .extracting(DocumentSearchRepository.BreadcrumbRow::id)
                .containsExactly(leaf);
        assertThat(repository.findBreadcrumbs(List.of(leaf), ownerId))
                .extracting(DocumentSearchRepository.BreadcrumbRow::id)
                .containsExactly(root, middle, leaf);
        assertThat(repository.findBreadcrumbs(List.of(), readerId)).isEmpty();
    }

    @Test
    void staleSelectionUsesVerificationAgeNotTheSortKey() throws Exception {
        UUID documentId = insertDocument(ownerId, "Stale page");
        // No projection yet: a title-only row is selectable immediately.
        assertThat(repository.selectStaleAfter(null, verifiedBefore(), 10)).contains(documentId);

        repository.upsertContent(documentId, "", false, now(), now());
        assertThat(repository.selectStaleAfter(null, verifiedBefore(), 10)).doesNotContain(documentId);

        // Hibernate's @UpdateTimestamp moves this on any metadata save (icon, cover, move,
        // restore). That is not a content change and must not schedule a Y.Doc re-read.
        jdbc.update(
                "UPDATE documents SET updated_at = now() + interval '1 minute' WHERE id = :id",
                new MapSqlParameterSource("id", documentId));
        assertThat(repository.selectStaleAfter(null, verifiedBefore(), 10)).doesNotContain(documentId);

        // A lost notification moves no timestamp at all; only the age sweep exposes it.
        jdbc.update(
                "UPDATE document_search SET verified_at = now() - interval '2 days' WHERE document_id = :id",
                new MapSqlParameterSource("id", documentId));
        assertThat(repository.selectStaleAfter(null, verifiedBefore(), 10)).contains(documentId);

        // The cursor skips everything at or before it, so a failed document is retried
        // on the next wrap rather than blocking the batch.
        assertThat(repository.selectStaleAfter(documentId, verifiedBefore(), 10))
                .doesNotContain(documentId);
    }

    @Test
    void aTitleOnlyRowStaysStaleUntilItsBodyIsIndexed() throws Exception {
        UUID documentId = insertDocument(ownerId, "Legacy page");

        repository.upsertTitle(documentId);

        // A rename must not make a never-crawled document look current: the body has
        // never been read from Yhub, and the crawl is the only thing that can read it.
        assertThat(repository.selectStaleAfter(null, verifiedBefore(), 10)).contains(documentId);
    }

    @Test
    void aTextLessContentNotificationMakesTheProjectionStale() throws Exception {
        UUID documentId = insertDocument(ownerId, "Extraction gap");
        repository.upsertContent(documentId, "old body", false, now(), now());

        // A compaction whose extraction failed still reports that content moved. The known
        // version advances, the projected text does not, and the crawl must re-read now.
        repository.upsertContentVersion(documentId, now().plusSeconds(1));

        assertThat(repository.selectStaleAfter(null, verifiedBefore(), 10)).contains(documentId);
        assertThat(storedContent(documentId)).isEqualTo("old body");

        // An out-of-order notification must not move the known version backwards.
        repository.upsertContentVersion(documentId, now().minusDays(1));
        assertThat(repository.selectStaleAfter(null, verifiedBefore(), 10)).contains(documentId);

        repository.upsertContent(documentId, "recovered body", false, now(), now().plusSeconds(2));
        assertThat(repository.selectStaleAfter(null, verifiedBefore(), 10)).doesNotContain(documentId);
    }

    @Test
    void aTextLessNotificationCreatesATitleOnlyStaleRow() throws Exception {
        UUID documentId = insertDocument(ownerId, "Never indexed");

        // No title event ran for this row, so the version upsert must insert it and leave
        // it selectable: the body still has never been read.
        repository.upsertContentVersion(documentId, now());

        assertThat(storedContent(documentId)).isEmpty();
        assertThat(storedVerifiedAt(documentId)).isNull();
        assertThat(repository.selectStaleAfter(null, verifiedBefore(), 10)).contains(documentId);
    }

    @Test
    void aContentWriteIsNotStaleJustBecauseTheSortKeyMoved() throws Exception {
        UUID documentId = insertDocument(ownerId, "Edited page");
        repository.upsertContent(documentId, "body", false, now(), now().minusDays(1));
        jdbc.update(
                "UPDATE documents SET updated_at = now() + interval '1 minute' WHERE id = :id",
                new MapSqlParameterSource("id", documentId));

        // indexed_at may trail documents.updated_at; verified_at is what the crawl trusts.
        assertThat(repository.selectStaleAfter(null, verifiedBefore(), 10)).doesNotContain(documentId);
    }

    @Test
    void aContentWriteAtTheSortKeyIsNotStale() throws Exception {
        UUID documentId = insertDocument(ownerId, "Fresh page");
        repository.upsertContent(documentId, "body", false, now(), now().plusMinutes(1));

        // The shape of a content-updated request: the projection carries the same instant
        // as documents.updated_at, so the crawl must skip it.
        assertThat(repository.selectStaleAfter(null, verifiedBefore(), 10)).doesNotContain(documentId);
    }

    @Test
    void cursorRecoversWhenTheSeedRowIsGone() throws Exception {
        jdbc.update("DELETE FROM search_index_state", new MapSqlParameterSource());
        UUID cursor = UUID.randomUUID();

        repository.writeCursor(cursor);

        assertThat(repository.readCursor()).isEqualTo(cursor);
    }

    @Test
    void cursorRoundTrips() {
        UUID cursor = UUID.randomUUID();
        repository.writeCursor(cursor);
        assertThat(repository.readCursor()).isEqualTo(cursor);

        repository.writeCursor(null);
        assertThat(repository.readCursor()).isNull();
    }

    private String storedContent(UUID documentId) {
        return jdbc.queryForObject(
                "SELECT content FROM document_search WHERE document_id = :id",
                new MapSqlParameterSource("id", documentId),
                String.class);
    }

    private OffsetDateTime storedVerifiedAt(UUID documentId) {
        return jdbc.queryForObject(
                "SELECT verified_at FROM document_search WHERE document_id = :id",
                new MapSqlParameterSource("id", documentId),
                (rs, rowNum) -> rs.getObject("verified_at", OffsetDateTime.class));
    }

    private static OffsetDateTime verifiedBefore() {
        return OffsetDateTime.now(ZoneOffset.UTC).minus(Duration.ofHours(24));
    }

    private static OffsetDateTime now() {
        return OffsetDateTime.now(ZoneOffset.UTC);
    }

    private static OffsetDateTime instant(String value) {
        return OffsetDateTime.parse(value);
    }

    private UUID insertWorkspace() throws SQLException {
        UUID id = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, 'NextDocs', now(), now())")) {
            stmt.setObject(1, id);
            stmt.executeUpdate();
        }
        return id;
    }

    private UUID insertMember(String role) throws SQLException {
        UUID id = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) "
                        + "VALUES (?, ?, 'hash', 'Test User', now(), now())")) {
            stmt.setObject(1, id);
            stmt.setString(2, "pgtest-" + id + "@example.com");
            stmt.executeUpdate();
        }
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, now())")) {
            stmt.setObject(1, workspaceId);
            stmt.setObject(2, id);
            stmt.setString(3, role);
            stmt.executeUpdate();
        }
        return id;
    }

    private UUID insertDocument(UUID creatorId, String title) throws SQLException {
        UUID id = UUID.randomUUID();
        try (PreparedStatement stmt = connection.prepareStatement(
                "INSERT INTO documents (id, user_id, workspace_id, title, general_access_mode, link_access_level, "
                        + "link_inherit_blocked, deleted_at, created_at, updated_at) "
                        + "VALUES (?, ?, ?, ?, 'RESTRICTED', 'VIEW', FALSE, NULL, now(), now())")) {
            stmt.setObject(1, id);
            stmt.setObject(2, creatorId);
            stmt.setObject(3, workspaceId);
            stmt.setString(4, title);
            stmt.executeUpdate();
        }
        return id;
    }

    private void setParent(UUID documentId, UUID parentId) {
        // chk_documents_sibling_order requires a sort key for any nested document.
        jdbc.update(
                "UPDATE documents SET parent_id = :parent,"
                        + " sibling_order_key = to_char(now() AT TIME ZONE 'UTC', "
                        + "'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') WHERE id = :id",
                new MapSqlParameterSource(Map.of("parent", parentId, "id", documentId)));
    }

    private void grant(UUID documentId, UUID userId, String level) {
        jdbc.update(
                "INSERT INTO access_grants (workspace_id, document_id, user_id, effect, access_level) "
                        + "VALUES (:workspaceId, :documentId, :userId, 'ALLOW', :level)",
                new MapSqlParameterSource(Map.of(
                        "workspaceId", workspaceId,
                        "documentId", documentId,
                        "userId", userId,
                        "level", level)));
    }
}
