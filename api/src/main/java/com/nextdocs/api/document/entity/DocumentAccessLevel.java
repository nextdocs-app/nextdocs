package com.nextdocs.api.document.entity;

public enum DocumentAccessLevel {
    VIEW,
    COMMENT,
    EDIT,
    OWNER,
    NO_ACCESS;

    public boolean allowsEdit() {
        return this == EDIT || this == OWNER;
    }

    public boolean allowsComment() {
        return this == COMMENT || this == EDIT || this == OWNER;
    }

    public boolean allowsRead() {
        return this != NO_ACCESS;
    }
}
