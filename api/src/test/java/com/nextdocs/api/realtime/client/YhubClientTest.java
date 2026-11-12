package com.nextdocs.api.realtime.client;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class YhubClientTest {

    private final YhubClient client = new YhubClient("http://127.0.0.1:1", " token ", new ObjectMapper());

    @Test
    void readsTheFailedCountFromAReindexReply() {
        // The endpoint answers 200 even when individual documents could not be read, so the
        // count in the body is the only signal that a batch repaired nothing.
        assertThat(client.failedCount("{\"status\":\"ok\",\"indexed\":1,\"failed\":2}"))
                .isEqualTo(2);
    }

    @Test
    void treatsAMissingOrUnreadableReplyAsNoFailures() {
        assertThat(client.failedCount(null)).isZero();
        assertThat(client.failedCount("")).isZero();
        assertThat(client.failedCount("not-json")).isZero();
        assertThat(client.failedCount("{\"status\":\"ok\"}")).isZero();
    }
}
