package com.nextdocs.api.common.response;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ApiResponseTest {

    @Test
    void ok_withData_setsSuccessTrueAndData() {
        ApiResponse<String> response = ApiResponse.ok("payload");

        assertThat(response.isSuccess()).isTrue();
        assertThat(response.getData()).isEqualTo("payload");
        assertThat(response.getError()).isNull();
        assertThat(response.getMessage()).isNull();
        assertThat(response.getTimestamp()).isNotNull();
    }

    @Test
    void ok_withDataAndMessage_setsMessage() {
        ApiResponse<String> response = ApiResponse.ok("payload", "Created successfully");

        assertThat(response.isSuccess()).isTrue();
        assertThat(response.getData()).isEqualTo("payload");
        assertThat(response.getMessage()).isEqualTo("Created successfully");
        assertThat(response.getError()).isNull();
    }

    @Test
    void error_setsSuccessFalseAndErrorMessage() {
        ApiResponse<Void> response = ApiResponse.error("Something went wrong");

        assertThat(response.isSuccess()).isFalse();
        assertThat(response.getError()).isEqualTo("Something went wrong");
        assertThat(response.getData()).isNull();
        assertThat(response.getMessage()).isNull();
    }

    @Test
    void ok_supportsNullData() {
        ApiResponse<String> response = ApiResponse.ok(null);

        assertThat(response.isSuccess()).isTrue();
        assertThat(response.getData()).isNull();
    }
}
