package com.nextdocs.api.mention.util;

import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

/**
 * Finds the stable user ids in a BlockNote comment body.
 *
 * <p>The comment body stays the source of truth and is stored verbatim; this walk only
 * produces the mention index. It is deliberately schema-light: any object whose
 * {@code type} is {@code mention} and whose {@code props.userId} parses as a UUID
 * counts, wherever it sits in a block, a table cell, or a nested child.
 */
public final class CommentMentionExtractor {

    private static final String MENTION_TYPE = "mention";

    private CommentMentionExtractor() {}

    public static Set<UUID> extractUserIds(JsonNode body) {
        Set<UUID> userIds = new LinkedHashSet<>();
        collect(body, userIds);
        return userIds;
    }

    private static void collect(JsonNode node, Set<UUID> userIds) {
        if (node == null) {
            return;
        }
        if (node.isArray()) {
            for (JsonNode child : node) {
                collect(child, userIds);
            }
            return;
        }
        if (!node.isObject()) {
            return;
        }

        if (MENTION_TYPE.equals(text(node.get("type")))) {
            JsonNode props = node.get("props");
            UUID userId = uuid(props == null ? null : text(props.get("userId")));
            if (userId != null) {
                userIds.add(userId);
            }
        }

        for (JsonNode child : node) {
            collect(child, userIds);
        }
    }

    private static String text(JsonNode node) {
        return node != null && node.isTextual() ? node.asText() : null;
    }

    private static UUID uuid(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException ex) {
            // A malformed snapshot must not reject the whole comment: the mention
            // simply produces no notification index row.
            return null;
        }
    }
}
