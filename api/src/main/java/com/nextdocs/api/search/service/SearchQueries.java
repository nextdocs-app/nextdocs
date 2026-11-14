package com.nextdocs.api.search.service;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Builds the query forms Postgres receives.
 *
 * <p>User input is never concatenated into SQL: the parser produces either a prefix
 * tsquery from sanitized tokens or a LIKE pattern with wildcards escaped, and both are
 * bound as parameters.
 */
public final class SearchQueries {

    /** One prefix-friendly token: a single word of letters or digits. */
    private static final Pattern SIMPLE_TOKEN = Pattern.compile("[\\p{L}\\p{N}]+");

    /** Beyond this the "last token is a prefix" heuristic stops being a typing aid. */
    private static final int MAX_PREFIX_TOKENS = 10;

    private SearchQueries() {}

    /**
     * The optional prefix tsquery used while typing, or null when the input carries
     * syntax ({@code "quoted"}, {@code OR}, {@code -term}) that must be left to
     * {@code websearch_to_tsquery}. Only the last token is a prefix; earlier tokens stay
     * exact so typing "rep report" cannot collapse "report" into "reporting". Only
     * sanitized tokens ever reach {@code to_tsquery}, so no user character can occupy an
     * operator position.
     */
    static String prefixQuery(String raw) {
        String trimmed = raw.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        String[] tokens = trimmed.split("\\s+");
        if (tokens.length > MAX_PREFIX_TOKENS) {
            return null;
        }
        StringBuilder query = new StringBuilder();
        for (int i = 0; i < tokens.length; i++) {
            // "OR" is websearch syntax; folding it into a prefix query would change
            // which documents match, not just how they rank.
            if (!SIMPLE_TOKEN.matcher(tokens[i]).matches() || tokens[i].equalsIgnoreCase("or")) {
                return null;
            }
            if (i > 0) {
                query.append(" & ");
            }
            query.append(tokens[i]);
        }
        return query.append(":*").toString();
    }

    /**
     * A prefix pattern for the live-title branches, with LIKE wildcards escaped. The SQL
     * folds titles with {@code lower()}, and LIKE is case-sensitive, so the pattern must
     * be folded here too or every proper-noun query would miss. There is deliberately no
     * infix variant: a contains scan matches "an" inside "banana" and only adds noise.
     */
    public static String likePrefix(String raw) {
        return escapeLike(fold(raw)) + "%";
    }

    /**
     * Lowercases for the SQL side. {@link Locale#ROOT} matches Postgres {@code lower()} for
     * the common case; a Turkish-collated database folds {@code I} to a dotless ı, so a
     * prefix containing a capital I can miss there. That is a recall edge, not a safety one:
     * the pattern is always bound as a parameter.
     */
    private static String fold(String raw) {
        return raw.trim().toLowerCase(Locale.ROOT);
    }

    static String escapeLike(String raw) {
        return raw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }
}
