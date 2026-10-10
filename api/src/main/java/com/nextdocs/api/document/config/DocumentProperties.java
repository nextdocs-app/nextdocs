package com.nextdocs.api.document.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.documents")
@Getter
@Setter
public class DocumentProperties {

    /**
     * Hard cap on nesting depth: a root-to-node chain may hold at most this many
     * documents. Every reader assumes chains fit in this bound (the purge walk, the
     * breadcrumb and access ancestor walks, and the matching DB functions), so creates
     * and moves enforce it instead of letting an over-deep subtree wedge the nightly
     * trash purge.
     */
    public static final int MAX_TREE_DEPTH = 100;

    /** Days a document may remain in trash before the purge job deletes it permanently. */
    private int trashRetentionDays = 30;

    /** Spring @Scheduled cron expression for the trash purge job. */
    private String purgeCron = "0 0 3 * * *";
}
