package com.nextdocs.api.search.controller;

import com.nextdocs.api.auth.security.UserPrincipal;
import com.nextdocs.api.common.response.ApiResponse;
import com.nextdocs.api.search.dto.response.SearchHitResponse;
import com.nextdocs.api.search.dto.response.SearchResponse;
import com.nextdocs.api.search.service.SearchService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Min;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Authenticated document search. Share-link search is deliberately absent: a public page
 * must not silently enter every member's results, and guests have a separate channel.
 */
@RestController
@RequestMapping("/api/v1/search")
@RequiredArgsConstructor
@Tag(name = "Search", description = "Full-text search over documents the caller can read")
public class SearchController {

    private final SearchService searchService;

    @Operation(summary = "Search document titles and body text")
    @GetMapping
    public ResponseEntity<ApiResponse<SearchResponse>> search(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestParam("q") String query,
            // The service clamps to app.search.max-page-size; a fixed annotation here
            // would reject a valid request whenever the property is raised.
            @RequestParam(value = "limit", required = false) @Min(1) Integer limit,
            // Offset is clamped by the service to its own ceiling (1000), like the
            // limits above, so configuration and validation cannot disagree.
            @RequestParam(value = "offset", required = false) @Min(0) Integer offset) {
        return ResponseEntity.ok(ApiResponse.ok(searchService.search(principal.getId(), query, limit, offset)));
    }

    @Operation(summary = "Title suggestions for the quick-jump list")
    @GetMapping("/suggest")
    public ResponseEntity<ApiResponse<List<SearchHitResponse>>> suggest(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestParam("q") String query,
            @RequestParam(value = "limit", required = false) @Min(1) Integer limit) {
        return ResponseEntity.ok(ApiResponse.ok(searchService.suggest(principal.getId(), query, limit)));
    }
}
