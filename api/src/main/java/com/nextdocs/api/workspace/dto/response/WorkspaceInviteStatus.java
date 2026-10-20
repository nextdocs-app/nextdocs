package com.nextdocs.api.workspace.dto.response;

/** Outcome of one email in an invite batch. */
public enum WorkspaceInviteStatus {
    /** Invite created (or replaced). */
    INVITED,
    /** An active account already uses this email; roles change through the member endpoints. */
    ALREADY_MEMBER,
    /** Not an address any account could be created from; no invite was created. */
    INVALID_EMAIL
}
