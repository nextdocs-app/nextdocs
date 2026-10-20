package com.nextdocs.api.workspace.schedule;

import com.nextdocs.api.workspace.service.WorkspaceService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Reclaims icon uploads the owner never applied; see {@link WorkspaceService#purgeAbandonedIconUploads}. */
@Slf4j
@Component
@RequiredArgsConstructor
public class WorkspaceIconUploadCleanupScheduler {

    private final WorkspaceService workspaceService;

    @Scheduled(cron = "${app.workspaces.icon-upload-cleanup-cron:0 15 3 * * *}")
    public void purgeAbandonedIconUploads() {
        int purged = workspaceService.purgeAbandonedIconUploads();
        if (purged > 0) {
            log.info("Purged {} abandoned workspace icon upload(s).", purged);
        }
    }
}
