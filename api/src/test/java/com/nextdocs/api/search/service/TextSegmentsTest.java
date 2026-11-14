package com.nextdocs.api.search.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.nextdocs.api.search.dto.response.SearchTextSegmentResponse;
import java.util.List;
import org.junit.jupiter.api.Test;

class TextSegmentsTest {

    @Test
    void splitsPlainAndMatchedRuns() {
        String headline = "A " + TextSegments.MATCH_START + "search" + TextSegments.MATCH_STOP + " result";

        assertThat(TextSegments.parse(headline))
                .containsExactly(
                        new SearchTextSegmentResponse("A ", false),
                        new SearchTextSegmentResponse("search", true),
                        new SearchTextSegmentResponse(" result", false));
    }

    @Test
    void dropsStrayAndUnterminatedMarkers() {
        assertThat(TextSegments.parse("one" + TextSegments.MATCH_STOP + " two"))
                .containsExactly(new SearchTextSegmentResponse("one two", false));

        assertThat(TextSegments.parse("open " + TextSegments.MATCH_START + "ended"))
                .containsExactly(
                        new SearchTextSegmentResponse("open ", false), new SearchTextSegmentResponse("ended", false));
    }

    @Test
    void treatsAHeadlineWithoutMarkersAsOnePlainSegment() {
        assertThat(TextSegments.parse("no matches here"))
                .containsExactly(new SearchTextSegmentResponse("no matches here", false));
    }

    @Test
    void answersAnEmptyListForNullAndEmptyValues() {
        assertThat(TextSegments.parse(null)).isEmpty();
        assertThat(TextSegments.parse("")).isEmpty();
        assertThat(TextSegments.plain("")).isEmpty();
    }

    @Test
    void plainKeepsTheWholeValue() {
        List<SearchTextSegmentResponse> segments = TextSegments.plain("Untitled");

        assertThat(segments).containsExactly(new SearchTextSegmentResponse("Untitled", false));
    }

    @Test
    void headlineOptionsUseMarkersADocumentCannotContain() {
        assertThat(TextSegments.snippetOptions())
                .contains("StartSel=" + TextSegments.MATCH_START)
                .contains("StopSel=" + TextSegments.MATCH_STOP)
                .contains("MaxFragments=2");
        assertThat(TextSegments.titleOptions()).contains("HighlightAll=true");
    }
}
