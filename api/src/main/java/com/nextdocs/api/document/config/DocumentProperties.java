package com.nextdocs.api.document.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.documents")
@Getter
@Setter
public class DocumentProperties {

    /** Days a document may remain in trash before the purge job deletes it permanently. */
    private int trashRetentionDays = 30;

    /** Spring @Scheduled cron expression for the trash purge job. */
    private String purgeCron = "0 0 3 * * *";
}
