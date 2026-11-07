package com.nextdocs.api.realtime.client;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
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

    private static final int UPDATED_PAGE_LIMIT = 100;

    private final String baseUrl;
    private final String serviceToken;
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;

    public record UpdatedDocument(String docid, long t) {}

    public record UpdatedResponse(List<UpdatedDocument> docs, long next) {}

    /**
     * The three outcomes a projection read can have. Collapsing them was the bug: a
     * transient 503 or timeout looked like "the document is gone", so the projection
     * stamped {@code yhub_deleted_at} on live content.
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
        this.serviceToken = serviceToken;
        this.objectMapper = objectMapper;
        this.httpClient =
                HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    }

    /**
     * Seed an empty document's snapshot. Returns false on any failure; the caller decides
     * whether serving the session without a seed is safe (it is not: the client would
     * start from an empty document).
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

    public Optional<UpdatedResponse> updatedSince(long cursor, int limit) {
        try {
            int bounded = limit <= 0 ? UPDATED_PAGE_LIMIT : Math.min(limit, UPDATED_PAGE_LIMIT * 10);
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/api/updated/v1/nextdocs?since=" + cursor + "&limit=" + bounded))
                    .header("Authorization", "Bearer " + serviceToken)
                    .header("Accept", "application/json")
                    .timeout(Duration.ofSeconds(5))
                    .GET()
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                log.warn("Yhub updatedSince failed: status {}", response.statusCode());
                return Optional.empty();
            }

            JsonNode root = objectMapper.readTree(response.body());
            long next = root.has("next") ? root.get("next").asLong() : cursor;
            JsonNode docsNode = root.get("docs");
            List<UpdatedDocument> docs = new ArrayList<>();
            if (docsNode != null && docsNode.isArray()) {
                for (JsonNode item : docsNode) {
                    String docid = item.has("docid") ? item.get("docid").asText() : null;
                    long t = item.has("t") ? item.get("t").asLong() : 0L;
                    if (docid != null) {
                        docs.add(new UpdatedDocument(docid, t));
                    }
                }
            }
            return Optional.of(new UpdatedResponse(docs, next));
        } catch (Exception e) {
            log.warn("Failed to query updated documents from Yhub: {}", e.getMessage());
            return Optional.empty();
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
