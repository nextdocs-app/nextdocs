package com.nextdocs.api.search.service;

import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.pageicon.PageIconType;
import com.nextdocs.api.pageicon.dto.response.PageIconResponse;
import com.nextdocs.api.search.config.SearchProperties;
import com.nextdocs.api.search.dto.response.SearchBreadcrumbResponse;
import com.nextdocs.api.search.dto.response.SearchHitResponse;
import com.nextdocs.api.search.dto.response.SearchResponse;
import com.nextdocs.api.search.dto.response.SearchSpaceResponse;
import com.nextdocs.api.search.dto.response.SearchTextSegmentResponse;
import com.nextdocs.api.search.repository.DocumentSearchRepository;
import com.nextdocs.api.search.repository.DocumentSearchRepository.BreadcrumbRow;
import com.nextdocs.api.search.repository.DocumentSearchRepository.SearchRow;
import com.nextdocs.api.workspace.service.WorkspaceAccessService;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Read path for document search.
 *
 * <p>Membership is the outer gate and the workspace comes from it, never from the
 * request. Access to individual documents is resolved in SQL, so this service never
 * re-implements inheritance, barriers, or space caps in Java.
 */
@Service
@RequiredArgsConstructor
public class SearchService {

    private static final Logger log = LoggerFactory.getLogger(SearchService.class);

    private static final int DEFAULT_LIMIT = 20;
    private static final int DEFAULT_SUGGEST_LIMIT = 8;
    private static final int MAX_SUGGEST_LIMIT = 10;
    private static final int MAX_OFFSET = 1000;

    private final SearchProperties properties;
    private final WorkspaceAccessService workspaceAccessService;
    private final DocumentSearchRepository repository;

    @Transactional(readOnly = true)
    public SearchResponse search(UUID userId, String rawQuery, Integer limit, Integer offset) {
        requireEnabled();
        String query = requireQuery(rawQuery, 1);
        int pageSize = clamp(limit == null ? DEFAULT_LIMIT : limit, 1, properties.getMaxPageSize());
        int start = offset == null ? 0 : offset;
        if (start < 0 || start > MAX_OFFSET) {
            // Clamping would serve the same last page for every offset beyond the ceiling,
            // so a paging client would never see the set end.
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Offset must be between 0 and " + MAX_OFFSET + ".");
        }
        UUID workspaceId =
                workspaceAccessService.requireMember(userId).workspace().getId();
        String prefix = SearchQueries.prefixQuery(query);

        long startedAt = System.nanoTime();
        repository.applyStatementTimeout();
        // One extra row answers hasMore without a COUNT over every match.
        List<SearchRow> rows =
                withSearchTimeout(() -> repository.search(workspaceId, userId, query, prefix, pageSize + 1, start));
        boolean hasMore = rows.size() > pageSize;
        List<SearchRow> page = hasMore ? rows.subList(0, pageSize) : rows;

        Enrichment enrichment = withSearchTimeout(() -> enrich(page, userId));
        List<SearchHitResponse> items =
                page.stream().map(row -> toHit(row, enrichment)).toList();

        // DEBUG, not INFO: one line per request would be the hottest line in the service once
        // as-you-type search is in use. The query text can hold sensitive strings, so only
        // its shape is logged, at any level.
        log.debug(
                "Search queryLength={} hasPrefix={} hits={} hasMore={} tookMs={}",
                query.codePointCount(0, query.length()),
                prefix != null,
                items.size(),
                hasMore,
                (System.nanoTime() - startedAt) / 1_000_000);
        return new SearchResponse(query, items, hasMore, start + items.size());
    }

    /** Title-only quick-jump results. Body text is deliberately not searched here. */
    @Transactional(readOnly = true)
    public List<SearchHitResponse> suggest(UUID userId, String rawQuery, Integer limit) {
        requireEnabled();
        String query = requireQuery(rawQuery, 1);
        int pageSize = clamp(
                limit == null ? DEFAULT_SUGGEST_LIMIT : limit,
                1,
                Math.min(MAX_SUGGEST_LIMIT, properties.getMaxPageSize()));
        UUID workspaceId =
                workspaceAccessService.requireMember(userId).workspace().getId();

        repository.applyStatementTimeout();
        List<SearchRow> rows = withSearchTimeout(() -> repository.suggest(workspaceId, userId, query, pageSize));
        Enrichment enrichment = withSearchTimeout(() -> enrich(rows, userId));
        return rows.stream().map(row -> toHit(row, enrichment)).toList();
    }

    private void requireEnabled() {
        if (!properties.isEnabled()) {
            // Masked as absent rather than advertised: a disabled instance should not
            // document that the endpoint exists.
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
    }

    private String requireQuery(String raw, int minCodePoints) {
        String query = raw == null ? "" : raw.trim();
        int length = query.codePointCount(0, query.length());
        if (length < minCodePoints || length > properties.getMaxQueryLength()) {
            throw new ApiException(
                    ErrorCode.VALIDATION_FAILED,
                    "Query must be between " + minCodePoints + " and " + properties.getMaxQueryLength()
                            + " characters.");
        }
        return query;
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(value, max));
    }

    /**
     * Maps a Postgres statement timeout to the degraded-search answer.
     *
     * <p>The timeout is scoped to the surrounding transaction, so it bounds every statement
     * in the request, not just the ranking query: the recursive breadcrumb walk and the
     * space-name lookup can hit it too. A 500 would tell the caller nothing they can act on,
     * and the retry it invites would fail the same way.
     */
    private static <T> T withSearchTimeout(Supplier<T> query) {
        try {
            return query.get();
        } catch (QueryTimeoutException e) {
            throw new ApiException(ErrorCode.SEARCH_TIMEOUT);
        }
    }

    /**
     * Ancestors and space for one page of hits. Two extra queries regardless of page
     * size: the recursive chain carries its own document ids, and space names are one
     * lookup for the distinct ids the chain found.
     */
    private Enrichment enrich(List<SearchRow> rows, UUID userId) {
        if (rows.isEmpty()) {
            return new Enrichment(Map.of(), Map.of());
        }
        List<UUID> documentIds = rows.stream().map(SearchRow::documentId).toList();
        List<BreadcrumbRow> chain = repository.findBreadcrumbs(documentIds, userId);

        Map<UUID, List<SearchBreadcrumbResponse>> breadcrumbs = new LinkedHashMap<>();
        for (UUID documentId : documentIds) {
            breadcrumbs.put(documentId, new ArrayList<>());
        }
        Map<UUID, UUID> spaceIds = new HashMap<>();
        for (BreadcrumbRow node : chain) {
            // Rows are ordered root-first, so the first link of a document is its root
            // page; only a root carries the space anchor.
            if (!spaceIds.containsKey(node.startId())) {
                spaceIds.put(node.startId(), node.spaceId());
            }
            if (node.depth() > 0) {
                breadcrumbs.get(node.startId()).add(new SearchBreadcrumbResponse(node.id(), node.title()));
            }
        }

        Set<UUID> distinctSpaceIds =
                spaceIds.values().stream().filter(Objects::nonNull).collect(Collectors.toSet());
        Map<UUID, String> spaceNames = repository.findSpaceNames(distinctSpaceIds);
        Map<UUID, SearchSpaceResponse> spaces = new HashMap<>();
        spaceIds.forEach((documentId, spaceId) -> {
            String name = spaceId == null ? null : spaceNames.get(spaceId);
            if (spaceId != null && name != null) {
                spaces.put(documentId, new SearchSpaceResponse(spaceId, name));
            }
        });
        return new Enrichment(Map.copyOf(breadcrumbs), Map.copyOf(spaces));
    }

    private static SearchHitResponse toHit(SearchRow row, Enrichment enrichment) {
        return new SearchHitResponse(
                row.documentId(),
                titleSegments(row),
                TextSegments.parse(row.snippet()),
                enrichment.breadcrumbs().getOrDefault(row.documentId(), List.of()),
                enrichment.spaces().get(row.documentId()),
                PageIconResponse.from(iconType(row.iconType()), row.iconValue(), row.iconColor()),
                row.updatedAt());
    }

    private static List<SearchTextSegmentResponse> titleSegments(SearchRow row) {
        if (row.titleHeadline() != null) {
            List<SearchTextSegmentResponse> segments = TextSegments.parse(row.titleHeadline());
            if (!segments.isEmpty()) {
                return segments;
            }
        }
        return TextSegments.plain(row.title());
    }

    private static PageIconType iconType(String raw) {
        // Stored as the enum name by the icon applier; a null column means no icon. Parse
        // like PageIconValidator.parseType so a legacy mixed-case row renders instead of
        // failing the whole result page, and an unknown value degrades to "no icon".
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return PageIconType.valueOf(raw.strip().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private record Enrichment(
            Map<UUID, List<SearchBreadcrumbResponse>> breadcrumbs, Map<UUID, SearchSpaceResponse> spaces) {}
}
