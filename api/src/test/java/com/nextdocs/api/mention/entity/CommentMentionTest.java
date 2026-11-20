package com.nextdocs.api.mention.entity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

class CommentMentionTest {

    @Test
    void applyCreatedAtFillsAMissingTimestamp() {
        CommentMention mention = CommentMention.builder().build();

        mention.applyCreatedAt();

        assertNotNull(mention.getCreatedAt());
    }

    @Test
    void applyCreatedAtKeepsAnExistingTimestamp() {
        OffsetDateTime createdAt = OffsetDateTime.of(2026, 1, 1, 0, 0, 0, 0, ZoneOffset.UTC);
        CommentMention mention = CommentMention.builder().createdAt(createdAt).build();

        mention.applyCreatedAt();

        assertEquals(createdAt, mention.getCreatedAt());
    }
}
