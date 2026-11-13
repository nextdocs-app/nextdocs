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
                .hasValue(2);
    }

    @Test
    void reportsAnUnstatedFailureCountAsUnknownRatherThanZero() {
        // A malformed or contract-changed reply must not read as a clean pass.
        assertThat(client.failedCount(null)).isEmpty();
        assertThat(client.failedCount("")).isEmpty();
        assertThat(client.failedCount("not-json")).isEmpty();
        assertThat(client.failedCount("{\"status\":\"ok\"}")).isEmpty();
        assertThat(client.failedCount("{\"status\":\"ok\",\"failed\":\"two\"}")).isEmpty();
        assertThat(client.failedCount("{\"status\":\"ok\",\"failed\":2.5}")).isEmpty();
        assertThat(client.failedCount("{\"status\":\"ok\",\"failed\":-1}")).isEmpty();
    }
}
