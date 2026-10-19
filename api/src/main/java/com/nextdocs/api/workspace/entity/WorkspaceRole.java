package com.nextdocs.api.workspace.entity;

import java.util.Locale;

/** A member's administrative role in the workspace. Roles gate admin actions only. */
public enum WorkspaceRole {
    /** Full control: rename the workspace, manage every member and invite any role. */
    OWNER,
    /** Manage member-only invites and remove plain members. */
    ADMIN,
    /** Read the workspace and its member roster. */
    MEMBER;

    /** Admin or owner. */
    public boolean canManageMembers() {
        return this != MEMBER;
    }

    /**
     * Whether this role may issue invites for {@code target}: owners grant any role,
     * admins only plain members (mirroring removal, where admins touch members only).
     */
    public boolean canGrant(WorkspaceRole target) {
        return this == OWNER || target == MEMBER;
    }

    /** Case-insensitive parse of a wire value, e.g. {@code "admin"}. */
    public static WorkspaceRole parse(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("Role cannot be null or blank");
        }
        return WorkspaceRole.valueOf(raw.strip().toUpperCase(Locale.ROOT));
    }
}
