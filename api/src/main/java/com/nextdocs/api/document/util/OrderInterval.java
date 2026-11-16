package com.nextdocs.api.document.util;

/**
 * Places one page between the neighbours a drag named.
 *
 * <p>The neighbours arrive as display values, so they can be inverted (a client that
 * sends [next, prev]) and they can be adjacent in the namespace even when other rows sit
 * between them. The real successor/predecessor is therefore read back from the namespace
 * before the midpoint is taken: a key computed against the requested pair alone can
 * collide with a row the client does not render, such as a trashed page.
 *
 * <p>The requested key of a neighbour the namespace no longer holds (trashed or purged by
 * another tab) still bounds the interval: the real successor can sit above it, and
 * placing after that successor would drop the page past the slot the caller chose.
 *
 * <p>Both personal namespaces (Private and Shared) place keys this way; only the source
 * of the neighbours differs, which is what {@link Neighbors} abstracts.
 */
public final class OrderInterval {

    /** The key source of one order namespace: the caller's Private or Shared section. */
    public interface Neighbors {

        /** The nearest existing key above {@code key}, or null when none exists. */
        String after(String key);

        /** The nearest existing key below {@code key}, or null when none exists. */
        String before(String key);

        /** The highest existing key in the namespace, or null when it is empty. */
        String last();
    }

    private OrderInterval() {}

    /**
     * The key that lands between {@code prevKey} and {@code nextKey}. Either may be null
     * (an open end); both null appends after {@link Neighbors#last()}.
     *
     * @throws IllegalArgumentException when the interval has no room left, which the
     *     caller reports as a position conflict rather than a 500
     */
    public static String placeBetween(String prevKey, String nextKey, Neighbors neighbors) {
        String prev = prevKey;
        String next = nextKey;
        if (prev != null && next != null && prev.compareTo(next) > 0) {
            prev = nextKey;
            next = prevKey;
        }
        if (prev != null) {
            String successor = neighbors.after(prev);
            // The successor is normally the tighter bound, but the requested next neighbour
            // can be absent from the namespace; then it is the ceiling, not the successor
            // that sits above it.
            String upper = successor;
            if (next != null && (upper == null || next.compareTo(upper) < 0)) {
                upper = next;
            }
            return FractionalIndex.keyBetween(prev, upper);
        }
        if (next != null) {
            return FractionalIndex.keyBetween(neighbors.before(next), next);
        }
        return FractionalIndex.keyBetween(neighbors.last(), null);
    }
}
