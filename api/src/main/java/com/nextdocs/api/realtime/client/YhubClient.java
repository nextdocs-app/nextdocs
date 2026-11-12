package com.nextdocs.api.realtime.client;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Base64;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Component
public class YhubClient {

    private static final Logger log = LoggerFactory.getLogger(YhubClient.class);

    /** Upper bound for one recheck body; the realtime side has its own, higher cap. */
    private static final int RECHECK_BATCH_SIZE = 500;

    private final String baseUrl;
    private final String serviceToken;
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;

    /**
     * The three outcomes a content read can have. Collapsing them would make a
     * transient 503 or timeout look like "the document is gone" and paint an empty
     * editor over live content; the caller maps NOT_FOUND to empty and TRANSIENT to 503.
     */
    public enum FetchStatus {
        OK,
        NOT_FOUND,
        TRANSIENT
    }

    public record UpdateFetch(FetchStatus status, byte[] update) {
        public static UpdateFetch ok(byte[] update) {
            return new UpdateFetch(FetchStatus.OK, update);
        }

        public static UpdateFetch notFound() {
            return new UpdateFetch(FetchStatus.NOT_FOUND, null);
        }

        public static UpdateFetch transientFailure() {
            return new UpdateFetch(FetchStatus.TRANSIENT, null);
        }
    }

    public YhubClient(
            @Value("${app.yhub.base-url:http://localhost:1234}") String baseUrl,
            @Value("${app.yhub.service-token}") String serviceToken,
            ObjectMapper objectMapper) {
        this.baseUrl = baseUrl.replaceAll("/+$", "");
        // Match the realtime service's trimmed comparison; a trailing newline from a
        // mounted secret would otherwise make the header invalid or the value unequal.
        this.serviceToken = serviceToken.trim();
        this.objectMapper = objectMapper;
        this.httpClient =
                HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    }

    /**
     * Apply an initial Yjs update to a room, used by document creation. Returns false on
     * any failure; the caller fails the create so the offline copy is retried rather than
     * silently left only in the browser.
     */
    public boolean seed(UUID documentId, byte[] updateBytes) {
        if (updateBytes == null || updateBytes.length == 0) {
            return false;
        }
        try {
            String b64 = Base64.getEncoder().encodeToString(updateBytes);
            String json = objectMapper.writeValueAsString(Map.of("update", b64));
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/api/ydoc/v1/nextdocs/" + documentId))
                    .header("Authorization", "Bearer " + serviceToken)
                    .header("Content-Type", "application/json")
                    .timeout(Duration.ofSeconds(5))
                    .method("PATCH", HttpRequest.BodyPublishers.ofString(json))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() >= 200 && response.statusCode() < 300) {
                return true;
            }
            log.warn("Yhub seed failed for doc {}: status {}", documentId, response.statusCode());
            return false;
        } catch (Exception e) {
            log.error("Failed to seed document {} to Yhub: {}", documentId, e.getMessage());
            return false;
        }
    }

    public UpdateFetch fetchUpdate(UUID documentId) {
        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/api/ydoc/v1/nextdocs/" + documentId))
                    .header("Authorization", "Bearer " + serviceToken)
                    .header("Accept", "application/json")
                    .timeout(Duration.ofSeconds(5))
                    .GET()
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            int status = response.statusCode();
            if (status == 404) {
                return UpdateFetch.notFound();
            }
            if (status < 200 || status >= 300) {
                log.warn("Yhub fetchUpdate failed for doc {}: status {}", documentId, status);
                return UpdateFetch.transientFailure();
            }

            JsonNode root = objectMapper.readTree(response.body());
            JsonNode docNode = root.get("doc");
            if (docNode == null || docNode.isNull()) {
                // Only a missing node is absence: a never-written room answers 200 with an
                // empty update, and an empty snapshot is real content. Reporting either as
                // a deletion would wipe live content.
                return UpdateFetch.notFound();
            }
            return UpdateFetch.ok(Base64.getDecoder().decode(docNode.asText()));
        } catch (Exception e) {
            log.warn("Failed to fetch update for document {} from Yhub: {}", documentId, e.getMessage());
            return UpdateFetch.transientFailure();
        }
    }

    /**
     * Ask Yhub to re-authorize the open sockets of every document in one request. Access
     * is inherited, so a change on one page can affect its whole subtree; one call per
     * document would fan out into hundreds of HTTP requests on a space-wide edit.
     */
    public void recheck(Collection<UUID> documentIds, List<UUID> userIds) {
        if (documentIds == null || documentIds.isEmpty()) {
            return;
        }
        List<UUID> distinct = List.copyOf(new LinkedHashSet<>(documentIds));
        for (int start = 0; start < distinct.size(); start += RECHECK_BATCH_SIZE) {
            List<UUID> batch = distinct.subList(start, Math.min(start + RECHECK_BATCH_SIZE, distinct.size()));
            sendRecheck(batch, userIds);
        }
    }

    private void sendRecheck(List<UUID> documentIds, List<UUID> userIds) {
        try {
            Map<String, Object> body = new java.util.LinkedHashMap<>();
            body.put("docids", documentIds.stream().map(UUID::toString).toList());
            if (userIds != null && !userIds.isEmpty()) {
                body.put("users", userIds.stream().map(UUID::toString).toList());
            }
            String json = objectMapper.writeValueAsString(body);
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/api/recheck/v1/nextdocs"))
                    .header("Authorization", "Bearer " + serviceToken)
                    .header("Content-Type", "application/json")
                    .timeout(Duration.ofSeconds(5))
                    .POST(HttpRequest.BodyPublishers.ofString(json))
                    .build();

            httpClient
                    .sendAsync(request, HttpResponse.BodyHandlers.discarding())
                    .thenAccept(response -> {
                        if (response.statusCode() < 200 || response.statusCode() >= 300) {
                            log.warn("Yhub recheck failed: status {}", response.statusCode());
                        }
                    })
                    .exceptionally(ex -> {
                        log.warn("Failed async recheck for {} document(s): {}", documentIds.size(), ex.getMessage());
                        return null;
                    });
        } catch (Exception e) {
            log.warn("Failed to initiate recheck for {} document(s): {}", documentIds.size(), e.getMessage());
        }
    }

    /**
     * Ask the realtime service to re-extract text for documents whose search projection
     * is missing or stale. The API cannot parse Yjs, so it only identifies the ids from
     * Postgres; extraction stays in the one service that can read the Y.Doc.
     *
     * <p>Fire-and-forget like {@link #recheck}: the batch is idempotent, and a scheduled
     * job must not block a shared scheduler thread on a batch of document reads. The
     * caller advances its cursor regardless, so a failed batch is retried on a later
     * pass instead of wedging the queue.
     *
     * @param maxBatchSize documents per request; the realtime service rejects a larger
     *     batch, so this is the same {@code SEARCH_MAX_REINDEX_DOCS} value both services
     *     bind rather than a constant that can drift from it
     */
    public void reindexContent(Collection<UUID> documentIds, int maxBatchSize) {
        if (documentIds == null || documentIds.isEmpty()) {
            return;
        }
        int batchSize = Math.max(1, maxBatchSize);
        List<UUID> distinct = List.copyOf(new LinkedHashSet<>(documentIds));
        for (int start = 0; start < distinct.size(); start += batchSize) {
            List<UUID> batch = distinct.subList(start, Math.min(start + batchSize, distinct.size()));
            sendReindex(batch);
        }
    }

    private void sendReindex(List<UUID> documentIds) {
        try {
            String json = objectMapper.writeValueAsString(
                    Map.of("docids", documentIds.stream().map(UUID::toString).toList()));
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/api/search-reindex/v1/nextdocs"))
                    .header("Authorization", "Bearer " + serviceToken)
                    .header("Content-Type", "application/json")
                    // Each id costs one Y.Doc read, and the batch is sequential.
                    .timeout(Duration.ofSeconds(90))
                    .POST(HttpRequest.BodyPublishers.ofString(json))
                    .build();

            httpClient
                    // The body answers with the per-document counts, and an accepted batch can
                    // still have repaired nothing.
                    .sendAsync(request, HttpResponse.BodyHandlers.ofString())
                    .thenAccept(response -> {
                        if (response.statusCode() < 200 || response.statusCode() >= 300) {
                            log.warn("Realtime search reindex failed: status {}", response.statusCode());
                            return;
                        }
                        int failed = failedCount(response.body());
                        if (failed > 0) {
                            // Without this the only operator-visible line reports a successful
                            // pass for a batch whose documents all failed to read.
                            log.warn(
                                    "Realtime search reindex failed for {} of {} document(s)",
                                    failed,
                                    documentIds.size());
                        }
                    })
                    .exceptionally(ex -> {
                        log.warn(
                                "Failed async search reindex for {} document(s): {}",
                                documentIds.size(),
                                ex.getMessage());
                        return null;
                    });
        } catch (Exception e) {
            log.warn("Failed to initiate search reindex for {} document(s): {}", documentIds.size(), e.getMessage());
        }
    }

    /**
     * Documents the realtime service could not read in one batch. The endpoint answers 200
     * with per-id failures, so the status alone cannot distinguish a repaired page from one
     * that is still stale until the next crawl pass.
     */
    int failedCount(String body) {
        if (body == null || body.isBlank()) {
            return 0;
        }
        try {
            JsonNode failed = objectMapper.readTree(body).get("failed");
            return failed == null ? 0 : failed.asInt(0);
        } catch (RuntimeException e) {
            // An unreadable reply is not worth failing the crawl over: the documents stay
            // stale and the next pass retries them.
            return 0;
        }
    }

    /**
     * Hard-delete a document's content. 404 is success: the goal is that the content is
     * gone, and a retry after a partially applied purge must not stick forever.
     */
    public boolean hardDelete(UUID documentId) {
        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/api/ydoc/v1/nextdocs/" + documentId + "?hard=true"))
                    .header("Authorization", "Bearer " + serviceToken)
                    .timeout(Duration.ofSeconds(5))
                    .DELETE()
                    .build();

            HttpResponse<Void> response = httpClient.send(request, HttpResponse.BodyHandlers.discarding());
            int status = response.statusCode();
            if (status == 404 || (status >= 200 && status < 300)) {
                return true;
            }
            log.warn("Yhub hard delete failed for doc {}: status {}", documentId, status);
            return false;
        } catch (Exception e) {
            log.warn("Failed to hard delete doc {}: {}", documentId, e.getMessage());
            return false;
        }
    }
}
