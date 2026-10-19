package com.nextdocs.api.workspace.schedule;

import com.nextdocs.api.workspace.service.WorkspaceInviteService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Deletes expired invite rows after their retention window; see {@link WorkspaceInviteService#purgeExpiredInvites}. */
@Slf4j
@Component
@RequiredArgsConstructor
public class WorkspaceInviteCleanupScheduler {

    private final WorkspaceInviteService inviteService;

    @Scheduled(cron = "${app.workspace.invite-cleanup-cron:0 30 3 * * *}")
    public void purgeExpiredInvites() {
        int purged = inviteService.purgeExpiredInvites();
        if (purged > 0) {
            log.info("Purged {} expired workspace invite(s).", purged);
        }
    }
}
