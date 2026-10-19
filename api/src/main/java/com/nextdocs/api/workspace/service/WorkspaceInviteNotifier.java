package com.nextdocs.api.workspace.service;

import com.nextdocs.api.workspace.entity.WorkspaceInvite;

/**
 * Delivery seam for invite notices.
 *
 * <p>The signup URL carries the raw single-use token and travels only to the invited
 * address: the API never returns it, so email is what makes an invite usable and what
 * lets acceptance prove the mailbox. Implementations must not log the URL.
 */
public interface WorkspaceInviteNotifier {

    /**
     * Whether this instance can deliver invitations at all. When {@code false} the invite
     * lifecycle refuses to mint a link: handed to the admin instead of emailed, it would
     * stop being mailbox proof and become just another copyable URL.
     */
    boolean isDeliveryConfigured();

    /**
     * Called after the transaction that created or re-issued {@code invite} commits; an
     * invite a rollback undid is never announced. {@code invitationUrl} holds the token
     * in its fragment and must not be persisted or logged.
     */
    void inviteIssued(WorkspaceInvite invite, String invitationUrl);
}
