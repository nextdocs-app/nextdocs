package com.nextdocs.api.search.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Search tuning.
 *
 * <p>The reconcile cadence is deliberately not bound here: {@code DocumentSearchReconcileJob}
 * reads {@code app.search.reconcile-interval-ms} and {@code -initial-delay-ms} through its
 * {@code @Scheduled} placeholders straight from the environment, so adding fields with those
 * names would not change the schedule.
 */
@ConfigurationProperties(prefix = "app.search")
@Getter
@Setter
public class SearchProperties {

    /**
     * Gates the endpoint and every index write. The projection table is derived, so
     * disabling search never risks content: it only stops the rows being maintained.
     */
    private boolean enabled = true;

    /**
     * Postgres text search configuration. Stems are baked into the stored tsvector, so
     * changing this requires a full reindex.
     */
    private String language = "english";

    /** Cap for one document's text projection, in UTF-8 bytes. */
    private int maxContentBytes = 256 * 1024;

    /** Longest accepted query, in code points. */
    private int maxQueryLength = 200;

    /** Largest page a caller may request. */
    private int maxPageSize = 50;

    /** Per-query Postgres timeout, so a pathological query cannot hold a request thread. */
    private int statementTimeoutMs = 3000;

    /**
     * Documents per reindex request, and therefore the crawl's batch size. The realtime
     * service reads the same {@code SEARCH_MAX_REINDEX_DOCS} value for its own request
     * cap, so one setting bounds both sides and a batch can never be rejected for size.
     */
    private int maxReindexDocs = 50;
}
