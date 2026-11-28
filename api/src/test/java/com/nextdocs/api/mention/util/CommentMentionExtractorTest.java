package com.nextdocs.api.mention.util;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class CommentMentionExtractorTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void extractsMentionUserIdsFromNestedBlocks() throws Exception {
        UUID alice = UUID.randomUUID();
        UUID bob = UUID.randomUUID();
        String body = """
                [
                  {
                    "type": "paragraph",
                    "content": [
                      {"type": "text", "text": "ping "},
                      {"type": "mention", "props": {"userId": "%s", "label": "Alice"}},
                      {"type": "text", "text": " and "},
                      {"type": "mention", "props": {"userId": "%s", "label": "Bob"}}
                    ]
                  },
                  {
                    "type": "paragraph",
                    "content": [],
                    "children": [
                      {
                        "type": "paragraph",
                        "content": [
                          {"type": "mention", "props": {"userId": "%s", "label": "Alice again"}}
                        ]
                      }
                    ]
                  }
                ]
                """.formatted(alice, bob, alice);

        Set<UUID> ids = CommentMentionExtractor.extractUserIds(objectMapper.readTree(body));

        // Duplicates collapse, and nesting does not hide a mention.
        assertEquals(Set.of(alice, bob), ids);
    }

    @Test
    void ignoresMalformedAndEmptyMentionProps() throws Exception {
        UUID alice = UUID.randomUUID();
        String body = """
                [
                  {"type": "mention", "props": {"userId": "not-a-uuid", "label": "Nope"}},
                  {"type": "mention", "props": {"userId": "", "label": "Empty"}},
                  {"type": "mention", "props": {"label": "Missing"}},
                  {"type": "mention"},
                  {"type": "mention", "props": {"userId": 42, "label": "Numeric"}},
                  {"type": "mention", "props": {"userId": "%s", "label": "Alice"}}
                ]
                """.formatted(alice);

        assertEquals(Set.of(alice), CommentMentionExtractor.extractUserIds(objectMapper.readTree(body)));
    }

    @Test
    void treatsAMissingOrScalarBodyAsNoMentions() throws Exception {
        assertEquals(Set.of(), CommentMentionExtractor.extractUserIds(null));
        assertEquals(Set.of(), CommentMentionExtractor.extractUserIds(objectMapper.readTree("\"text\"")));
        assertEquals(Set.of(), CommentMentionExtractor.extractUserIds(objectMapper.readTree("[]")));
    }
}
