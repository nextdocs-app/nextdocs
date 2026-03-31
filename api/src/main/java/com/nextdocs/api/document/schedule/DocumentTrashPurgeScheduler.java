package com.nextdocs.api.document.schedule;

import com.nextdocs.api.document.service.DocumentService;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class DocumentTrashPurgeScheduler {

    private static final Logger log = LoggerFactory.getLogger(DocumentTrashPurgeScheduler.class);

    private final DocumentService documentService;

    @Scheduled(cron = "${app.documents.purge-cron:0 0 3 * * *}")
    public void purgeExpiredTrash() {
        int purged = documentService.purgeExpiredTrash();
        if (purged > 0) {
            log.info("Purged {} document(s) past trash retention.", purged);
        }
    }
}
