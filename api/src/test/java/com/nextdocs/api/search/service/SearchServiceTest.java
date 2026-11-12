package com.nextdocs.api.search.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.search.config.SearchProperties;
import com.nextdocs.api.search.dto.response.SearchHitResponse;
import com.nextdocs.api.search.dto.response.SearchResponse;
import com.nextdocs.api.search.dto.response.SearchTextSegmentResponse;
import com.nextdocs.api.search.repository.DocumentSearchRepository;
import com.nextdocs.api.search.repository.DocumentSearchRepository.BreadcrumbRow;
import com.nextdocs.api.search.repository.DocumentSearchRepository.SearchRow;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.entity.WorkspaceMember;
import com.nextdocs.api.workspace.service.WorkspaceAccessService;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.QueryTimeoutException;

@ExtendWith(MockitoExtension.class)
class SearchServiceTest {

    @Mock
    private SearchProperties properties;

    @Mock
    private WorkspaceAccessService workspaceAccessService;

    @Mock
    private DocumentSearchRepository repository;

    @InjectMocks
    private SearchService searchService;

    private UUID userId;
    private UUID workspaceId;

    @BeforeEach
    void setUp() {
        userId = UUID.randomUUID();
        workspaceId = UUID.randomUUID();
        lenient().when(properties.isEnabled()).thenReturn(true);
        lenient().when(properties.getMaxQueryLength()).thenReturn(200);
        lenient().when(properties.getMaxPageSize()).thenReturn(50);
        lenient().when(properties.getStatementTimeoutMs()).thenReturn(3000);
    }

    private void memberOfWorkspace() {
        Workspace workspace = org.mockito.Mockito.mock(Workspace.class);
        lenient().when(workspace.getId()).thenReturn(workspaceId);
        WorkspaceMember member = org.mockito.Mockito.mock(WorkspaceMember.class);
        lenient()
                .when(workspaceAccessService.requireMember(userId))
                .thenReturn(new WorkspaceAccessService.Membership(workspace, member));
    }

    @Test
    void masksTheEndpointWhenSearchIsDisabled() {
        when(properties.isEnabled()).thenReturn(false);

        assertThatThrownBy(() -> searchService.search(userId, "auth", null, null))
                .isInstanceOf(ApiException.class)
                .matches(e -> ((ApiException) e).getErrorCode() == ErrorCode.NOT_FOUND);
        verify(repository, never()).search(any(), any(), any(), any(), anyInt(), anyInt());
    }

    @Test
    void rejectsQueriesOutsideTheConfiguredBounds() {
        assertThatThrownBy(() -> searchService.search(userId, "   ", null, null))
                .isInstanceOf(ApiException.class)
                .matches(e -> ((ApiException) e).getErrorCode() == ErrorCode.VALIDATION_FAILED);

        assertThatThrownBy(() -> searchService.suggest(userId, "   ", null))
                .isInstanceOf(ApiException.class)
                .matches(e -> ((ApiException) e).getErrorCode() == ErrorCode.VALIDATION_FAILED);
    }

    @Test
    void searchesFromOneCharacter() {
        memberOfWorkspace();
        when(repository.search(workspaceId, userId, "a", "a:*", 21, 0)).thenReturn(List.of());

        SearchResponse response = searchService.search(userId, " a ", null, null);

        assertThat(response.query()).isEqualTo("a");
        verify(repository).search(workspaceId, userId, "a", "a:*", 21, 0);
    }

    @Test
    void fetchesOneExtraRowToAnswerHasMoreWithoutACount() {
        memberOfWorkspace();
        SearchRow first = row("Doc one");
        SearchRow second = row("Doc two");
        SearchRow third = row("Doc three");
        when(repository.search(eq(workspaceId), eq(userId), eq("auth"), eq("auth:*"), eq(3), eq(0)))
                .thenReturn(List.of(first, second, third));

        SearchResponse response = searchService.search(userId, "  auth  ", 2, 0);

        assertThat(response.query()).isEqualTo("auth");
        assertThat(response.items()).hasSize(2);
        assertThat(response.hasMore()).isTrue();
        assertThat(response.nextOffset()).isEqualTo(2);
    }

    @Test
    void clampsPaginationToTheConfiguredPageSize() {
        memberOfWorkspace();
        when(repository.search(eq(workspaceId), eq(userId), anyString(), anyString(), anyInt(), anyInt()))
                .thenReturn(List.of());

        searchService.search(userId, "auth", 500, 0);

        verify(repository).search(eq(workspaceId), eq(userId), eq("auth"), eq("auth:*"), eq(51), eq(0));
    }

    @Test
    void enrichesHitsWithBreadcrumbsAndSpace() {
        memberOfWorkspace();
        UUID documentId = UUID.randomUUID();
        UUID rootId = UUID.randomUUID();
        UUID spaceId = UUID.randomUUID();
        SearchRow hit = new SearchRow(
                documentId,
                "Auth guide",
                "\u0001Auth\u0002 guide",
                "See \u0001auth\u0002",
                "emoji",
                "🔐",
                null,
                OffsetDateTime.now());
        when(repository.search(eq(workspaceId), eq(userId), eq("auth"), eq("auth:*"), eq(21), eq(0)))
                .thenReturn(List.of(hit));
        when(repository.findBreadcrumbs(List.of(documentId), userId))
                .thenReturn(List.of(
                        new BreadcrumbRow(documentId, rootId, "Engineering", spaceId, 1),
                        new BreadcrumbRow(documentId, documentId, "Auth guide", null, 0)));
        when(repository.findSpaceNames(Set.of(spaceId))).thenReturn(Map.of(spaceId, "Engineering"));

        SearchHitResponse result =
                searchService.search(userId, "auth", null, null).items().get(0);

        assertThat(result.breadcrumb()).hasSize(1);
        assertThat(result.breadcrumb().get(0).title()).isEqualTo("Engineering");
        assertThat(result.space()).isNotNull();
        assertThat(result.space().name()).isEqualTo("Engineering");
        assertThat(result.icon().type()).isEqualTo("emoji");
        assertThat(result.title()).extracting(SearchTextSegmentResponse::match).containsExactly(true, false);
        assertThat(result.snippet())
                .extracting(SearchTextSegmentResponse::match)
                .containsExactly(false, true);
    }

    @Test
    void suggestionsAreTitleOnlyAndCarryNoSnippet() {
        memberOfWorkspace();
        SearchRow row =
                new SearchRow(UUID.randomUUID(), "Untitled", null, null, null, null, null, OffsetDateTime.now());
        when(repository.suggest(eq(workspaceId), eq(userId), eq("unt"), eq(8))).thenReturn(List.of(row));

        List<SearchHitResponse> hits = searchService.suggest(userId, "unt", null);

        assertThat(hits).hasSize(1);
        assertThat(hits.get(0).title()).containsExactly(new SearchTextSegmentResponse("Untitled", false));
        assertThat(hits.get(0).snippet()).isEmpty();
    }

    @Test
    void toleratesLegacyOrUnknownStoredIconTypes() {
        memberOfWorkspace();
        SearchRow hit =
                new SearchRow(UUID.randomUUID(), "Doc", null, null, "not-a-type", "x", null, OffsetDateTime.now());
        when(repository.search(eq(workspaceId), eq(userId), anyString(), anyString(), anyInt(), anyInt()))
                .thenReturn(List.of(hit));
        when(repository.findBreadcrumbs(any(), eq(userId))).thenReturn(List.of());

        SearchHitResponse result =
                searchService.search(userId, "doc", null, null).items().get(0);

        assertThat(result.icon()).isNull();
    }

    @Test
    void rejectsAnOffsetPastTheCeiling() {
        // Clamping would serve the same last page forever, so a paging client would never
        // see the result set end.
        assertThatThrownBy(() -> searchService.search(userId, "auth", 20, 1001))
                .isInstanceOf(ApiException.class)
                .matches(e -> ((ApiException) e).getErrorCode() == ErrorCode.VALIDATION_FAILED);
        verify(repository, never()).search(any(), any(), any(), any(), anyInt(), anyInt());
    }

    @Test
    void reportsAStatementTimeoutAsADegradedSearch() {
        memberOfWorkspace();
        when(repository.search(eq(workspaceId), eq(userId), eq("auth"), eq("auth:*"), eq(21), eq(0)))
                .thenThrow(new QueryTimeoutException("canceling statement due to statement timeout"));

        assertThatThrownBy(() -> searchService.search(userId, "auth", null, null))
                .isInstanceOf(ApiException.class)
                .matches(e -> ((ApiException) e).getErrorCode() == ErrorCode.SEARCH_TIMEOUT);
    }

    @Test
    void reportsATimeoutWhileResolvingBreadcrumbsAsADegradedSearch() {
        memberOfWorkspace();
        when(repository.search(eq(workspaceId), eq(userId), eq("doc"), eq("doc:*"), eq(21), eq(0)))
                .thenReturn(List.of(row("Doc")));
        // The statement timeout covers every statement in the transaction, so the recursive
        // breadcrumb walk has to answer exactly like the ranking query.
        when(repository.findBreadcrumbs(any(), eq(userId)))
                .thenThrow(new QueryTimeoutException("canceling statement due to statement timeout"));

        assertThatThrownBy(() -> searchService.search(userId, "doc", null, null))
                .isInstanceOf(ApiException.class)
                .matches(e -> ((ApiException) e).getErrorCode() == ErrorCode.SEARCH_TIMEOUT);
    }

    private static SearchRow row(String title) {
        return new SearchRow(UUID.randomUUID(), title, title, "snippet", null, null, null, OffsetDateTime.now());
    }
}
