package com.nextdocs.api.document.util;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.sql.SQLException;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;

class OrderPositionConflictTest {

    @Test
    void duplicatePositionKeyIsRetryable() {
        DataIntegrityViolationException ex = new DataIntegrityViolationException(
                "could not execute statement",
                new RuntimeException(
                        "ERROR: duplicate key value violates unique constraint \"idx_user_document_orders_user_order_key\""));

        assertTrue(OrderPositionConflict.isRetryable(ex));
    }

    @Test
    void h2UniqueIndexMessageIsRetryable() {
        DataIntegrityViolationException ex = new DataIntegrityViolationException(
                "could not execute statement",
                new RuntimeException(
                        "Unique index or primary key violation: \"PUBLIC.UQ_USER_SHARED_ORDERS_USER_ORDER_KEY_INDEX_2 ON PUBLIC.USER_SHARED_DOCUMENT_ORDERS(USER_ID, ORDER_KEY)\""));

        assertTrue(OrderPositionConflict.isRetryable(ex));
    }

    @Test
    void notNullViolationOnTheSameColumnIsNotRetryable() {
        DataIntegrityViolationException ex = new DataIntegrityViolationException(
                "could not execute statement",
                new RuntimeException(
                        "ERROR: null value in column \"order_key\" of relation \"documents\" violates not-null constraint"));

        assertFalse(OrderPositionConflict.isRetryable(ex));
    }

    @Test
    void foreignKeyViolationIsNotRetryable() {
        DataIntegrityViolationException ex = new DataIntegrityViolationException(
                "could not execute statement",
                new RuntimeException(
                        "ERROR: insert or update on table \"documents\" violates foreign key constraint \"fk_documents_parent\""));

        assertFalse(OrderPositionConflict.isRetryable(ex));
    }

    @Test
    void sqlStateRejectsANotNullFailureEvenWhenItNamesTheOrderKeyColumn() {
        DataIntegrityViolationException ex = new DataIntegrityViolationException(
                "could not execute statement",
                new RuntimeException(new SQLException(
                        "null value in column \"order_key\" of relation \"documents\" violates not-null constraint",
                        "23502")));

        assertFalse(OrderPositionConflict.isRetryable(ex));
    }

    @Test
    void sqlStateConfirmsAPositionCollisionTheDriverReportedAsUnique() {
        DataIntegrityViolationException ex = new DataIntegrityViolationException(
                "could not execute statement",
                new RuntimeException(new SQLException(
                        "ERROR: duplicate key value violates unique constraint "
                                + "\"idx_documents_parent_sibling_order_key_unique\"",
                        "23505")));

        assertTrue(OrderPositionConflict.isRetryable(ex));
    }

    @Test
    void sqlStateUniqueViolationOnAnotherTableIsNotRetryable() {
        DataIntegrityViolationException ex = new DataIntegrityViolationException(
                "could not execute statement",
                new RuntimeException(new SQLException(
                        "ERROR: duplicate key value violates unique constraint \"uq_users_email\"", "23505")));

        assertFalse(OrderPositionConflict.isRetryable(ex));
    }

    @Test
    void sqlStateIsReadEvenWhenTheDriverExceptionWrapsADeeperNonSqlCause() {
        // A pool or socket failure under the driver's SQLException leaves a non-SQL root
        // cause. The state the driver reported still decides, so a foreign-key failure whose
        // message happens to name a position index is not retried.
        SQLException driverFailure = new SQLException("could not execute statement", "23503");
        driverFailure.initCause(new RuntimeException("ERROR: duplicate key value violates unique constraint "
                + "\"idx_documents_parent_sibling_order_key_unique\""));

        DataIntegrityViolationException ex =
                new DataIntegrityViolationException("could not execute statement", driverFailure);

        assertFalse(OrderPositionConflict.isRetryable(ex));
    }

    @Test
    void unrelatedUniqueConstraintIsNotRetryable() {
        DataIntegrityViolationException ex = new DataIntegrityViolationException(
                "could not execute statement",
                new RuntimeException("ERROR: duplicate key value violates unique constraint \"uq_users_email\""));

        assertFalse(OrderPositionConflict.isRetryable(ex));
    }
}
