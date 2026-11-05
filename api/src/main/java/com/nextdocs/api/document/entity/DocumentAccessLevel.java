package com.nextdocs.api.document.entity;

public enum DocumentAccessLevel {
    VIEW,
    COMMENT,
    EDIT,
    OWNER,
    NO_ACCESS;

    /**
     * The stronger of two independent levels, such as resolved identity and public
     * link access. Do not use this to resolve inheritance or explicit overrides.
     */
    public static DocumentAccessLevel broadest(DocumentAccessLevel first, DocumentAccessLevel second) {
        return rank(first) >= rank(second) ? first : second;
    }

    private static int rank(DocumentAccessLevel level) {
        return switch (level) {
            case OWNER -> 4;
            case EDIT -> 3;
            case COMMENT -> 2;
            case VIEW -> 1;
            case NO_ACCESS -> 0;
        };
    }

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
