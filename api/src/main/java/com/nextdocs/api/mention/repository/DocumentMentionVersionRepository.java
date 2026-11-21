package com.nextdocs.api.mention.repository;

import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * The ordering mark for a document's mention set.
 *
 * <p>The upsert is the only statement: the row it locks stays locked until the caller's
 * transaction commits, which is what keeps the version check and the mention writes of
 * two concurrent {@code content-updated} calls from interleaving.
 */
@Repository
@RequiredArgsConstructor
public class DocumentMentionVersionRepository {

    /**
     * Postgres-only, like the search projection: H2 never runs it (the main suite has no
     * migration table and mocks this repository). {@code >=} mirrors the search guard, so
     * a retry of the read that is already indexed is idempotent rather than rejected.
     */
    static final String CLAIM_SQL = "INSERT INTO document_mention_versions (document_id, source_produced_at)"
            // The document is selected rather than trusted: a page deleted between the
            // service's lookup and this write must be a no-op, not a foreign-key failure
            // that realtime would retry forever.
            + " SELECT d.id, :producedAt FROM documents d WHERE d.id = :documentId"
            + " ON CONFLICT (document_id) DO UPDATE"
            + " SET source_produced_at = EXCLUDED.source_produced_at"
            + " WHERE EXCLUDED.source_produced_at >= document_mention_versions.source_produced_at";

    private final NamedParameterJdbcTemplate jdbc;

    /**
     * Claims this read as the newest mention set for the document.
     *
     * @return false when a newer read already owns the index, in which case the caller
     *     must not touch its rows: applying this set would restore a mention the newer
     *     body removed, or queue a notification the newer body cancelled.
     */
    public boolean claim(UUID documentId, OffsetDateTime producedAt) {
        int claimed = jdbc.update(
                CLAIM_SQL,
                new MapSqlParameterSource().addValue("documentId", documentId).addValue("producedAt", producedAt));
        return claimed > 0;
    }
}
