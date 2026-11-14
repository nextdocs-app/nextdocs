package com.nextdocs.api.search.service;

import com.nextdocs.api.search.dto.response.SearchTextSegmentResponse;
import java.util.ArrayList;
import java.util.List;

/**
 * Turns a {@code ts_headline} result into plain-text segments.
 *
 * <p>Postgres marks matched words with two control characters. The extractor strips
 * control characters from stored text, so a real document can never contain them. The
 * API returns segments rather than HTML: highlighting stays a client concern and no
 * document text can become markup.
 */
public final class TextSegments {

    public static final char MATCH_START = '\u0001';
    public static final char MATCH_STOP = '\u0002';

    private TextSegments() {}

    /** Splits one headline into plain and matched segments, dropping empty ones. */
    public static List<SearchTextSegmentResponse> parse(String headline) {
        if (headline == null || headline.isEmpty()) {
            return List.of();
        }
        List<SearchTextSegmentResponse> segments = new ArrayList<>();
        StringBuilder plain = new StringBuilder();
        int index = 0;
        while (index < headline.length()) {
            char current = headline.charAt(index);
            if (current == MATCH_START) {
                flush(segments, plain);
                int end = headline.indexOf(MATCH_STOP, index + 1);
                if (end < 0) {
                    // Unterminated marker: keep the remaining text rather than dropping it.
                    plain.append(headline, index + 1, headline.length());
                    break;
                }
                if (end > index + 1) {
                    segments.add(new SearchTextSegmentResponse(headline.substring(index + 1, end), true));
                }
                index = end + 1;
                continue;
            }
            // A stray stop marker would otherwise leak a control character into JSON.
            if (current != MATCH_STOP) {
                plain.append(current);
            }
            index++;
        }
        flush(segments, plain);
        return segments;
    }

    /** The whole text as a single unmatched segment, for values that carry no highlight. */
    public static List<SearchTextSegmentResponse> plain(String text) {
        if (text == null || text.isEmpty()) {
            return List.of();
        }
        return List.of(new SearchTextSegmentResponse(text, false));
    }

    /** {@code ts_headline} options for a snippet: two fragments, bounded around matches. */
    public static String snippetOptions() {
        return "MaxFragments=2, MaxWords=30, MinWords=10, FragmentDelimiter=…, StartSel=" + MATCH_START + ", StopSel="
                + MATCH_STOP;
    }

    /** {@code ts_headline} options for a title: the whole value, every match marked. */
    public static String titleOptions() {
        return "HighlightAll=true, StartSel=" + MATCH_START + ", StopSel=" + MATCH_STOP;
    }

    private static void flush(List<SearchTextSegmentResponse> segments, StringBuilder plain) {
        if (plain.isEmpty()) {
            return;
        }
        segments.add(new SearchTextSegmentResponse(plain.toString(), false));
        plain.setLength(0);
    }
}
