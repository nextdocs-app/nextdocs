package com.nextdocs.api.document.util;

import java.sql.SQLException;
import java.util.Locale;
import org.springframework.dao.DataIntegrityViolationException;

/**
 * Distinguishes a duplicate tree position from every other constraint failure.
 *
 * <p>Create, move and restore retry a position collision, but a blanket {@link
 * DataIntegrityViolationException} catch also swallowed unrelated failures (a NOT NULL
 * column, a foreign key) and re-reported them as a stale position. Retrying cannot fix
 * those, and the position message sends the caller after the wrong problem.
 *
 * <p>The driver's SQLSTATE decides first when it is available: only a unique violation
 * can be fixed by a retry, so a NOT NULL (23502) or foreign-key (23503) failure is
 * rejected even when its message happens to name an order-key column. The message is
 * still needed for the second question — which unique index was hit — and as the only
 * signal when an exception is wrapped without a {@link SQLException}.
 */
public final class OrderPositionConflict {

    /** Postgres and H2 both report a unique violation with this SQLSTATE. */
    private static final String UNIQUE_VIOLATION = "23505";

    /**
     * The unique indexes that only a concurrent position change can trip. The pair on
     * user_document_orders is deliberately absent: a duplicate (user, document) row is a
     * logic bug, not a race, so retrying it would loop three times for nothing.
     *
     * <p>The Shared table's (user, document) index is absent for the opposite reason:
     * the race is real, but {@link com.nextdocs.api.document.service.SharedSectionService}
     * row-locks the page it inserts for, and its callers sit outside this retry loop (a
     * grant written by two tabs would fail before any reordering happens).
     */
    private static final String[] POSITION_CONSTRAINTS = {
        "idx_user_document_orders_user_order_key",
        "uq_user_shared_orders_user_order_key",
        "idx_documents_parent_sibling_order_key_unique",
        "idx_documents_space_sibling_order_key_unique",
    };

    private OrderPositionConflict() {}

    public static boolean isRetryable(DataIntegrityViolationException ex) {
        Throwable cause = ex.getMostSpecificCause();
        String sqlState = sqlStateOf(ex);
        if (sqlState != null && !UNIQUE_VIOLATION.equals(sqlState)) {
            return false;
        }

        String message = cause != null ? cause.getMessage() : ex.getMessage();
        if (message == null) {
            return false;
        }
        String normalized = message.toLowerCase(Locale.ROOT);

        // A unique violation is the only kind a retry can resolve. Requiring this
        // marker keeps a NOT NULL message such as
        // `null value in column "order_key" ... violates not-null constraint`
        // from looking like a position collision just because it names the column.
        if (!normalized.contains("duplicate key")
                && !normalized.contains("unique constraint")
                && !normalized.contains("unique index")) {
            return false;
        }
        for (String constraint : POSITION_CONSTRAINTS) {
            if (normalized.contains(constraint)) {
                return true;
            }
        }
        return false;
    }

    /**
     * The nearest SQLSTATE in the cause chain, if the driver exposed one. The walk starts at
     * the outermost exception, not at {@code getMostSpecificCause()}: the driver's {@link
     * SQLException} can wrap a deeper non-SQL cause (a pool or socket failure), and starting
     * from the root would skip the state the driver actually reported.
     */
    private static String sqlStateOf(Throwable cause) {
        for (Throwable cursor = cause; cursor != null; cursor = cursor.getCause()) {
            if (cursor instanceof SQLException sqlException && sqlException.getSQLState() != null) {
                return sqlException.getSQLState();
            }
            if (cursor.getCause() == cursor) {
                break;
            }
        }
        return null;
    }
}
