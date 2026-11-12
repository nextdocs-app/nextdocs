package com.nextdocs.api.search.repository;

import com.nextdocs.api.search.config.SearchProperties;
import com.nextdocs.api.search.service.SearchQueries;
import com.nextdocs.api.search.service.TextSegments;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * SQL for the derived search projection and the read path.
 *
 * <p>All search SQL is Postgres-only and runs through JDBC rather than JPA: the tsvector
 * column is not mapped by an entity, and the projection is written with explicit upserts
 * so title and content writes cannot clobber each other.
 */
@Repository
public class DocumentSearchRepository {

    /**
     * Title-only upsert, used when a rename or create has already committed.
     *
     * <p>{@code source_produced_at} and {@code indexed_at} stay NULL here: this row has
     * never seen the body, and a title write must not claim it did. A rename that stamped
     * {@code now()} would make a never-crawled document look current, and the reconcile
     * job selects on {@code indexed_at}, so its body would never be indexed. A rename does
     * leave the row stale (the document version moved), which costs one later reindex and
     * keeps a single meaning for the column.
     */
    static final String TITLE_UPSERT_SQL = "INSERT INTO document_search"
            + " (document_id, content, truncated, source_produced_at, indexed_at, tsv)"
            + " SELECT d.id, '', FALSE, NULL, NULL,"
            + " setweight(to_tsvector(CAST(:language AS regconfig), unaccent('unaccent', d.title)), 'A')"
            + " FROM documents d WHERE d.id = :documentId"
            + " ON CONFLICT (document_id) DO UPDATE"
            // EXCLUDED.tsv is the title-only vector from the current documents.title.
            + " SET tsv = EXCLUDED.tsv"
            + " || setweight(to_tsvector(CAST(:language AS regconfig), unaccent('unaccent', document_search.content)), 'B')";

    /**
     * Content upsert from the realtime service. The title comes from {@code documents},
     * never from the service payload, and the ordering guard keeps a retried older event
     * from overwriting a newer projection.
     */
    static final String CONTENT_UPSERT_SQL = "INSERT INTO document_search"
            + " (document_id, content, truncated, source_produced_at, indexed_at, tsv)"
            + " SELECT d.id, :content, :truncated, LEAST(:producedAt, now()), :indexedAt,"
            + " setweight(to_tsvector(CAST(:language AS regconfig), unaccent('unaccent', d.title)), 'A')"
            + " || setweight(to_tsvector(CAST(:language AS regconfig), unaccent('unaccent', :content)), 'B')"
            + " FROM documents d WHERE d.id = :documentId"
            + " ON CONFLICT (document_id) DO UPDATE"
            + " SET content = EXCLUDED.content, truncated = EXCLUDED.truncated,"
            + " source_produced_at = EXCLUDED.source_produced_at,"
            // The version this projection reflects, not the wall clock: the content-updated
            // request records the same instant as documents.updated_at, so the reconcile
            // crawl does not select a document that was indexed by that very request.
            + " indexed_at = EXCLUDED.indexed_at, tsv = EXCLUDED.tsv"
            + " WHERE document_search.source_produced_at IS NULL"
            + " OR EXCLUDED.source_produced_at >= document_search.source_produced_at";

    /**
     * Ranking runs before headlines: computing {@code ts_headline} for every match and
     * discarding all but a page would cost far more than the page itself.
     *
     * <p>Access is resolved inside the predicate, never post-filtered, so a grant, revoke,
     * move, archive, or trash takes effect on the next query without reindexing. Trashed
     * documents drop out through {@code deleted_at}, which the trash cascade also marks on
     * descendants.
     *
     * <p>How far past the requested page the ranking is allowed to reach before access is
     * resolved. Without a bound the resolver runs once per lexical match, which measured
     * at ~9.6 s for 20k documents in one workspace; with it, a request resolves at most
     * this many extra rows. A caller who cannot see more than this many top-ranked rows
     * gets a shorter page rather than a request that exceeds the statement timeout.
     */
    static final int RESOLVE_WINDOW_SLACK = 100;

    static final String SEARCH_SQL = "WITH q AS ("
            + " SELECT websearch_to_tsquery(CAST(:language AS regconfig),"
            + " unaccent('unaccent', CAST(:query AS text))) AS web,"
            + " CASE WHEN CAST(:prefix AS text) IS NULL THEN NULL"
            + " ELSE COALESCE(NULLIF(to_tsquery(CAST(:language AS regconfig),"
            + " unaccent('unaccent', CAST(:prefix AS text))), ''::tsquery),"
            // A typing prefix like a:* or and:* must not disappear as an English stopword.
            + " to_tsquery('simple', unaccent('unaccent', CAST(:prefix AS text)))) END AS prefix"
            + "), candidates AS ("
            + " SELECT s.document_id FROM document_search s"
            + " JOIN documents d ON d.id = s.document_id CROSS JOIN q"
            + " WHERE d.workspace_id = :workspaceId AND d.deleted_at IS NULL"
            + " AND (s.tsv @@ q.web OR (q.prefix IS NOT NULL AND s.tsv @@ q.prefix))"
            + " UNION"
            + " SELECT d.id FROM documents d"
            + " WHERE d.workspace_id = :workspaceId AND d.deleted_at IS NULL"
            + " AND CAST(:titlePrefix AS text) IS NOT NULL"
            + " AND unaccent('unaccent', lower(d.title))"
            + " LIKE unaccent('unaccent', CAST(:titlePrefix AS text)) ESCAPE '\\'"
            + "), scored AS MATERIALIZED ("
            + " SELECT d.id AS document_id,"
            // Exact title: the whole normalized title equals the query, or the query's
            // exact terms occur in the title. A prefix must never outrank this.
            + " CASE WHEN unaccent('unaccent', lower(d.title)) ="
            + " unaccent('unaccent', lower(CAST(:query AS text)))"
            + " OR tv.document @@ q.web THEN 5"
            // Title prefix: the last query token prefixes a title token (typing "an"
            // finds "analytics"), or the title literally starts with the query.
            + " WHEN (q.prefix IS NOT NULL AND tv.document @@ q.prefix)"
            + " OR (CAST(:titlePrefix AS text) IS NOT NULL"
            + " AND unaccent('unaccent', lower(d.title))"
            + " LIKE unaccent('unaccent', CAST(:titlePrefix AS text)) ESCAPE '\\') THEN 4"
            // Exact body match, only reached when neither title branch matched.
            + " WHEN s.tsv @@ q.web THEN 3"
            // Body prefix, then any other lexical candidate.
            + " WHEN q.prefix IS NOT NULL AND s.tsv @@ q.prefix THEN 2 ELSE 1 END AS tier,"
            + " GREATEST(ts_rank_cd(tv.document, q.web, 32),"
            + " COALESCE(ts_rank_cd(tv.document, q.prefix, 32), 0),"
            + " ts_rank_cd(s.tsv, q.web, 32),"
            + " COALESCE(ts_rank_cd(s.tsv, q.prefix, 32), 0)) AS score,"
            + " d.updated_at"
            + " FROM candidates c"
            + " JOIN documents d ON d.id = c.document_id"
            + " LEFT JOIN document_search s ON s.document_id = d.id"
            + " CROSS JOIN q"
            + " CROSS JOIN LATERAL (SELECT to_tsvector(CAST(:language AS regconfig),"
            + " unaccent('unaccent', d.title)) AS document) tv"
            + " WHERE d.workspace_id = :workspaceId"
            + " AND d.deleted_at IS NULL"
            + "), ranked AS MATERIALIZED ("
            + " SELECT scored.*, row_number() OVER (ORDER BY tier DESC, score DESC, updated_at DESC,"
            + " document_id) AS sort_rank"
            + " FROM scored"
            + "), resolve_window AS MATERIALIZED ("
            // Bounded before the resolver, not after: the window filter is cheap, and it
            // keeps the per-row PL/pgSQL access check proportional to a page instead of
            // to every document the query happens to match.
            + " SELECT * FROM ranked WHERE sort_rank <= :resolveWindow"
            + ")"
            + " SELECT r.document_id, d.title, d.updated_at, d.icon_type, d.icon_value, d.icon_color,"
            + " ts_headline(CAST(:language AS regconfig), d.title,"
            + " COALESCE(CASE WHEN s.tsv @@ q.web THEN q.web END, q.prefix, q.web), :titleOptions) AS title_headline,"
            + " ts_headline(CAST(:language AS regconfig), s.content,"
            + " COALESCE(CASE WHEN s.tsv @@ q.web THEN q.web END, q.prefix, q.web), :snippetOptions) AS snippet"
            + " FROM resolve_window r"
            + " LEFT JOIN document_search s ON s.document_id = r.document_id"
            + " JOIN documents d ON d.id = r.document_id"
            + " CROSS JOIN q"
            + " WHERE resolve_identity_access(:userId, r.document_id, 'ACTIVE')"
            + " IN ('VIEW', 'COMMENT', 'EDIT', 'OWNER')"
            + " ORDER BY r.sort_rank"
            + " LIMIT :limit OFFSET :offset";

    /**
     * Title suggestions run against {@code documents} so a brand-new page is findable
     * before its first compaction. This is a bounded sequential scan of one workspace
     * (no trigram index by design, see §16 of the plan); the identity resolver gates the
     * rows only after the ranking window has narrowed them to a page. Matching is
     * prefix-only: an infix scan would return "banana" for "an" and is deliberately
     * absent. The query is unaccented too, so typing "café" matches the stored "Café",
     * which the column side folds to "cafe".
     *
     * <p>Measured before the window bound: typing a common prefix over 20k documents ran
     * the resolver 20k times and took ~8 s. The window keeps it near the page size.
     */
    static final String SUGGEST_SQL = "WITH candidates AS MATERIALIZED ("
            + " SELECT d.id AS document_id, d.title, d.updated_at,"
            + " d.icon_type, d.icon_value, d.icon_color,"
            + " unaccent('unaccent', lower(d.title)) AS folded_title"
            + " FROM documents d"
            + " WHERE d.workspace_id = :workspaceId"
            + " AND d.deleted_at IS NULL"
            + " AND unaccent('unaccent', lower(d.title))"
            + " LIKE unaccent('unaccent', CAST(:titlePrefix AS text)) ESCAPE '\\'"
            + "), ranked AS MATERIALIZED ("
            + " SELECT c.*, row_number() OVER (ORDER BY"
            + " CASE WHEN c.folded_title = unaccent('unaccent', lower(CAST(:query AS text)))"
            + " THEN 0 ELSE 1 END, c.updated_at DESC, c.document_id) AS sort_rank"
            + " FROM candidates c"
            + "), resolve_window AS MATERIALIZED ("
            + " SELECT * FROM ranked WHERE sort_rank <= :resolveWindow"
            + ")"
            + " SELECT w.document_id, w.title, w.updated_at, w.icon_type, w.icon_value, w.icon_color,"
            + " NULL AS title_headline, NULL AS snippet"
            + " FROM resolve_window w"
            + " WHERE resolve_identity_access(:userId, w.document_id, 'ACTIVE')"
            + " IN ('VIEW', 'COMMENT', 'EDIT', 'OWNER')"
            + " ORDER BY w.sort_rank"
            + " LIMIT :limit";

    /**
     * Ancestor chains for a page of hits, stopping at the first ancestor the caller cannot
     * read. A direct grant on a nested page does not make its restricted parents visible,
     * and their titles are not metadata the caller is entitled to; this mirrors
     * {@code DocumentService.getBreadcrumbs}, which also stops at the first denied node.
     */
    static final String BREADCRUMB_SQL = "WITH RECURSIVE chain AS ("
            + " SELECT d.id, d.parent_id, d.title, d.id AS start_id, d.space_id, 0 AS depth,"
            + " resolve_identity_access(:userId, d.id, 'ACTIVE')"
            + " IN ('VIEW', 'COMMENT', 'EDIT', 'OWNER') AS visible"
            + " FROM documents d WHERE d.id IN (:ids)"
            + " UNION ALL"
            + " SELECT p.id, p.parent_id, p.title, c.start_id, p.space_id, c.depth + 1,"
            + " resolve_identity_access(:userId, p.id, 'ACTIVE')"
            + " IN ('VIEW', 'COMMENT', 'EDIT', 'OWNER')"
            + " FROM documents p JOIN chain c ON p.id = c.parent_id"
            // Stop the walk at the first denied ancestor: continuing would emit its own
            // parent and leak the chain above it.
            + " WHERE c.depth < 100 AND c.visible"
            + ") SELECT start_id, id, title, space_id, depth FROM chain WHERE visible"
            + " ORDER BY start_id, depth DESC";

    static final String SPACE_NAMES_SQL = "SELECT id, name FROM spaces WHERE id IN (:ids)";

    /**
     * A row without {@code indexed_at} has a title only; its body has never been read from
     * Yhub, so it is stale however recently the title row was written.
     */
    static final String STALE_SQL = "SELECT d.id FROM documents d"
            + " LEFT JOIN document_search s ON s.document_id = d.id"
            + " WHERE d.deleted_at IS NULL"
            + " AND (s.indexed_at IS NULL OR s.indexed_at < d.updated_at)"
            + " AND (CAST(:cursor AS uuid) IS NULL OR d.id > CAST(:cursor AS uuid))"
            + " ORDER BY d.id LIMIT :limit";

    static final String READ_CURSOR_SQL = "SELECT cursor_id FROM search_index_state WHERE job_name = 'reconcile'";

    static final String WRITE_CURSOR_SQL = "INSERT INTO search_index_state (job_name, cursor_id, updated_at)"
            + " VALUES ('reconcile', CAST(:cursor AS uuid), now())"
            + " ON CONFLICT (job_name) DO UPDATE SET cursor_id = EXCLUDED.cursor_id, updated_at = now()";

    private final NamedParameterJdbcTemplate jdbc;
    private final SearchProperties properties;

    public DocumentSearchRepository(NamedParameterJdbcTemplate jdbc, SearchProperties properties) {
        this.jdbc = jdbc;
        this.properties = properties;
    }

    /** One ranked document. Suggestion rows carry no headline and no snippet. */
    public record SearchRow(
            UUID documentId,
            String title,
            String titleHeadline,
            String snippet,
            String iconType,
            String iconValue,
            String iconColor,
            OffsetDateTime updatedAt) {}

    /** One link of an ancestor chain: the page it belongs to, the ancestor, and its depth. */
    public record BreadcrumbRow(UUID startId, UUID id, String title, UUID spaceId, int depth) {}

    public void upsertTitle(UUID documentId) {
        jdbc.update(
                TITLE_UPSERT_SQL,
                new MapSqlParameterSource()
                        .addValue("documentId", documentId)
                        .addValue("language", properties.getLanguage()));
    }

    public void upsertContent(
            UUID documentId, String content, boolean truncated, OffsetDateTime producedAt, OffsetDateTime indexedAt) {
        jdbc.update(
                CONTENT_UPSERT_SQL,
                new MapSqlParameterSource()
                        .addValue("documentId", documentId)
                        .addValue("content", content)
                        .addValue("truncated", truncated)
                        .addValue("producedAt", producedAt)
                        .addValue("indexedAt", indexedAt)
                        .addValue("language", properties.getLanguage()));
    }

    /**
     * Bounds this transaction's search statements. {@code is_local = true} scopes the
     * setting to the surrounding transaction, so it cannot leak through the pooled
     * connection into an unrelated query.
     */
    public void applyStatementTimeout() {
        jdbc.queryForObject(
                "SELECT set_config('statement_timeout', :timeout, true)",
                new MapSqlParameterSource().addValue("timeout", String.valueOf(properties.getStatementTimeoutMs())),
                String.class);
    }

    public List<SearchRow> search(UUID workspaceId, UUID userId, String query, String prefix, int limit, int offset) {
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("workspaceId", workspaceId)
                .addValue("userId", userId)
                .addValue("query", query)
                .addValue("prefix", prefix)
                // Preserve single-character symbol/emoji titles without bypassing websearch syntax.
                .addValue("titlePrefix", titlePrefix(query, prefix))
                // Clamped by the service; LIMIT is parameterized, never concatenated.
                .addValue("limit", limit)
                .addValue("offset", offset)
                .addValue("resolveWindow", limit + offset + RESOLVE_WINDOW_SLACK)
                .addValue("language", properties.getLanguage())
                .addValue("titleOptions", TextSegments.titleOptions())
                .addValue("snippetOptions", TextSegments.snippetOptions());
        return jdbc.query(SEARCH_SQL, parameters, DocumentSearchRepository::mapSearchRow);
    }

    public List<SearchRow> suggest(UUID workspaceId, UUID userId, String query, int limit) {
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("workspaceId", workspaceId)
                .addValue("userId", userId)
                .addValue("query", query)
                .addValue("titlePrefix", SearchQueries.likePrefix(query))
                .addValue("resolveWindow", limit + RESOLVE_WINDOW_SLACK)
                .addValue("limit", limit);
        return jdbc.query(SUGGEST_SQL, parameters, DocumentSearchRepository::mapSearchRow);
    }

    /**
     * The literal title-prefix pattern for the live-title branch. Simple typing and a
     * single symbol/emoji query get one; websearch syntax does not, so quotes and
     * negation keep their meaning. The tsquery path prefixes only the last word; this
     * whole-query pattern exists so a page is findable before its projection row.
     */
    private static String titlePrefix(String query, String prefix) {
        boolean singleLiteral = query.codePointCount(0, query.length()) == 1 && !"\"'-".contains(query);
        return prefix != null || singleLiteral ? SearchQueries.likePrefix(query) : null;
    }

    /** Every ancestor link the caller may see, ordered root-first per document. */
    public List<BreadcrumbRow> findBreadcrumbs(Collection<UUID> documentIds, UUID userId) {
        if (documentIds.isEmpty()) {
            return List.of();
        }
        return jdbc.query(
                BREADCRUMB_SQL,
                new MapSqlParameterSource().addValue("ids", documentIds).addValue("userId", userId),
                (rs, rowNum) -> new BreadcrumbRow(
                        rs.getObject("start_id", UUID.class),
                        rs.getObject("id", UUID.class),
                        rs.getString("title"),
                        rs.getObject("space_id", UUID.class),
                        rs.getInt("depth")));
    }

    public Map<UUID, String> findSpaceNames(Collection<UUID> spaceIds) {
        if (spaceIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, String> names = new HashMap<>();
        jdbc.query(SPACE_NAMES_SQL, new MapSqlParameterSource("ids", spaceIds), rs -> {
            names.put(rs.getObject("id", UUID.class), rs.getString("name"));
        });
        return names;
    }

    /**
     * Documents whose projection is missing or older than the metadata row. The cursor
     * advances past a batch even when some documents fail, so a permanently failing
     * document cannot starve everything ordered after it.
     */
    public List<UUID> selectStaleAfter(UUID cursor, int limit) {
        return jdbc.query(
                STALE_SQL,
                new MapSqlParameterSource().addValue("cursor", cursor).addValue("limit", limit),
                (rs, rowNum) -> rs.getObject("id", UUID.class));
    }

    public UUID readCursor() {
        List<UUID> rows = jdbc.query(
                READ_CURSOR_SQL, new MapSqlParameterSource(), (rs, rowNum) -> rs.getObject("cursor_id", UUID.class));
        return rows.isEmpty() ? null : rows.get(0);
    }

    public void writeCursor(UUID cursor) {
        jdbc.update(WRITE_CURSOR_SQL, new MapSqlParameterSource("cursor", cursor));
    }

    private static SearchRow mapSearchRow(ResultSet rs, int rowNum) throws SQLException {
        return new SearchRow(
                rs.getObject("document_id", UUID.class),
                rs.getString("title"),
                rs.getString("title_headline"),
                rs.getString("snippet"),
                rs.getString("icon_type"),
                rs.getString("icon_value"),
                rs.getString("icon_color"),
                rs.getObject("updated_at", OffsetDateTime.class));
    }
}
