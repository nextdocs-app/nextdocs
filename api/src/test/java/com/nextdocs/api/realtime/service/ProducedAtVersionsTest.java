package com.nextdocs.api.realtime.service;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ProducedAtVersionsTest {

    private static final Instant ARRIVED = Instant.parse("2026-01-01T00:00:00Z");
    private static final Instant FUTURE = Instant.parse("2100-01-01T00:00:00Z");

    private final UUID documentId = UUID.randomUUID();

    @Test
    void keepsAValueFromThePast() {
        ProducedAtVersions versions = new ProducedAtVersions();
        Instant producedAt = ARRIVED.minusSeconds(5);

        assertEquals(producedAt, versions.assign(documentId, producedAt, ARRIVED));
    }

    @Test
    void fallsBackToArrivalWhenTheBodyNamesNoInstant() {
        ProducedAtVersions versions = new ProducedAtVersions();
        Instant later = ARRIVED.plusSeconds(10);

        assertEquals(ARRIVED, versions.assign(documentId, null, ARRIVED));
        // Nothing keys two such reads together, so each orders by its own arrival.
        assertEquals(later, versions.assign(documentId, null, later));
    }

    @Test
    void capsAFutureValueAtArrival() {
        ProducedAtVersions versions = new ProducedAtVersions();

        assertEquals(ARRIVED, versions.assign(documentId, FUTURE, ARRIVED));
    }

    @Test
    void aRetryOfTheSameReadKeepsTheFirstCap() {
        ProducedAtVersions versions = new ProducedAtVersions();
        Instant retried = ARRIVED.plusSeconds(2);
        versions.assign(documentId, FUTURE, ARRIVED);

        // Ordering the retry by its own arrival would put it after a newer read that
        // landed in between, which is what lets a stale body resurrect a mention.
        assertEquals(ARRIVED, versions.assign(documentId, FUTURE, retried));
    }

    @Test
    void aNewerReadGetsANewerCap() {
        ProducedAtVersions versions = new ProducedAtVersions();
        Instant newer = ARRIVED.plusSeconds(2);
        versions.assign(documentId, FUTURE, ARRIVED);

        assertEquals(newer, versions.assign(documentId, Instant.parse("2100-06-01T00:00:00Z"), newer));
    }

    @Test
    void anExpiredCapIsAssignedAgain() {
        ProducedAtVersions versions = new ProducedAtVersions(ProducedAtVersions.DEFAULT_MAX_ENTRIES, 0);
        Instant retried = ARRIVED.plusSeconds(2);
        versions.assign(documentId, FUTURE, ARRIVED);

        assertEquals(retried, versions.assign(documentId, FUTURE, retried));
    }

    @Test
    void keepsTwoDocumentsApart() {
        ProducedAtVersions versions = new ProducedAtVersions();
        Instant later = ARRIVED.plusSeconds(2);
        versions.assign(documentId, FUTURE, ARRIVED);

        assertEquals(later, versions.assign(UUID.randomUUID(), FUTURE, later));
    }
}
