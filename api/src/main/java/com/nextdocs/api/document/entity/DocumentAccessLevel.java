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
     *
     * <p>Inheritance is resolved inside one source by SQL: the nearest page with an
     * applicable row wins, and at that page the strongest positive wins. Combining
     * sources is the only place this method belongs; using it to choose an ancestor
     * would make a lower child override lose to a higher ancestor grant.
     */
    public static DocumentAccessLevel broadest(DocumentAccessLevel first, DocumentAccessLevel second) {
        return first.rank() >= second.rank() ? first : second;
    }

    /**
     * Numeric order used when comparing independent sources. NO_ACCESS maps to 0 (the
     * same as an absent grant), and the mapping must stay aligned with the SQL functions.
     * Because 0 is also "nothing here", identity resolution has to apply the NO_ACCESS
     * barrier before comparing ranks; {@link #broadest} is only for independent positive
     * channels.
     */
    public int rank() {
        return switch (this) {
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
