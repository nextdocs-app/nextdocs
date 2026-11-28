package com.nextdocs.api.mention.entity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

class DocumentMentionTest {

    @Test
    void applyCreatedAtFillsAMissingTimestamp() {
        DocumentMention mention = DocumentMention.builder().build();

        mention.applyCreatedAt();

        assertNotNull(mention.getCreatedAt());
    }

    @Test
    void applyCreatedAtKeepsAnExistingTimestamp() {
        OffsetDateTime createdAt = OffsetDateTime.of(2026, 1, 1, 0, 0, 0, 0, ZoneOffset.UTC);
        DocumentMention mention = DocumentMention.builder().createdAt(createdAt).build();

        mention.applyCreatedAt();

        assertEquals(createdAt, mention.getCreatedAt());
    }
}
