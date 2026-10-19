package com.nextdocs.api.workspace.service;

import com.nextdocs.api.workspace.entity.WorkspaceInvite;

/**
 * Fallback {@link WorkspaceInviteNotifier} for deployments without SMTP: it reports
 * delivery unavailable, and the invite lifecycle refuses to issue links through it.
 *
 * <p>It exists so the service always has a notifier to consult, but it never delivers:
 * an invited link the admin could read would no longer prove the invited mailbox.
 */
public class MailDisabledWorkspaceInviteNotifier implements WorkspaceInviteNotifier {

    @Override
    public boolean isDeliveryConfigured() {
        return false;
    }

    @Override
    public void inviteIssued(WorkspaceInvite invite, String invitationUrl) {
        // Unreachable while the service checks isDeliveryConfigured(): fail loudly
        // rather than let a token vanish on an instance that cannot deliver it.
        throw new IllegalStateException("Invitation issued although email delivery is not configured");
    }
}
