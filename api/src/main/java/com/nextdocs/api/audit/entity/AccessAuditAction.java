package com.nextdocs.api.audit.entity;

/**
 * The access mutations worth explaining after the fact.
 *
 * <p>Focuses on explicit access grant and membership changes. Structural tree operations
 * (reordering, reparenting) and tenant-level member off-boarding are lifecycle operations
 * intentionally outside this grant-level trail.
 */
public enum AccessAuditAction {
    COLLABORATOR_UPSERT,
    COLLABORATOR_UPDATE,
    COLLABORATOR_REMOVE,
    COLLABORATOR_LEAVE,
    SHARING_SETTINGS_UPDATE,
    GROUP_CREATE,
    GROUP_UPDATE,
    GROUP_DELETE,
    SPACE_MEMBER_ADD,
    SPACE_MEMBER_UPDATE,
    SPACE_MEMBER_REMOVE,
    SPACE_ARCHIVE,
    SPACE_RESTORE,
    SPACE_PAGE_ATTACH,
    SPACE_PAGE_DETACH
}
