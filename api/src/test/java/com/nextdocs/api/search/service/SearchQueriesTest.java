package com.nextdocs.api.search.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class SearchQueriesTest {

    @Test
    void makesOnlyTheLastTokenAPrefixWhileTyping() {
        assertThat(SearchQueries.prefixQuery("auth")).isEqualTo("auth:*");
        assertThat(SearchQueries.prefixQuery("auth flow")).isEqualTo("auth & flow:*");
        assertThat(SearchQueries.prefixQuery("rep report")).isEqualTo("rep & report:*");
        assertThat(SearchQueries.prefixQuery("  spaced   out  ")).isEqualTo("spaced & out:*");
    }

    @Test
    void leavesWebsearchSyntaxToWebsearch() {
        assertThat(SearchQueries.prefixQuery("\"auth flow\"")).isNull();
        assertThat(SearchQueries.prefixQuery("auth OR flow")).isNull();
        assertThat(SearchQueries.prefixQuery("-draft")).isNull();
        assertThat(SearchQueries.prefixQuery("don't")).isNull();
        assertThat(SearchQueries.prefixQuery("auth:*")).isNull();
        assertThat(SearchQueries.prefixQuery("a & b")).isNull();
    }

    @Test
    void rejectsAPathologicalNumberOfTokens() {
        assertThat(SearchQueries.prefixQuery("a b c d e f g h i j k")).isNull();
    }

    @Test
    void foldsCaseForTheCaseSensitiveLikeScan() {
        // The SQL folds the column with lower(); an unfolded pattern would miss every
        // proper noun the quick-jump is most often used for.
        assertThat(SearchQueries.likePrefix("CAFÉ")).isEqualTo("café%");
        assertThat(SearchQueries.likePrefix("Auth")).isEqualTo("auth%");
    }

    @Test
    void escapesLikeWildcards() {
        assertThat(SearchQueries.escapeLike("100%_done\\")).isEqualTo("100\\%\\_done\\\\");
        assertThat(SearchQueries.likePrefix("50%")).isEqualTo("50\\%%");
        assertThat(SearchQueries.likePrefix("auth")).isEqualTo("auth%");
    }
}
