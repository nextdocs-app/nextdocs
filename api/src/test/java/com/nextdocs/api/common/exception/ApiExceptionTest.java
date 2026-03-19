package com.nextdocs.api.common.exception;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ApiExceptionTest {

    @Test
    void constructor_withErrorCode_setsDefaultMessage() {
        ApiException ex = new ApiException(ErrorCode.INVALID_CREDENTIALS);

        assertThat(ex.getErrorCode()).isEqualTo(ErrorCode.INVALID_CREDENTIALS);
        assertThat(ex.getMessage()).isEqualTo(ErrorCode.INVALID_CREDENTIALS.defaultMessage());
    }

    @Test
    void constructor_withErrorCodeAndMessage_usesCustomMessage() {
        ApiException ex = new ApiException(ErrorCode.NOT_FOUND, "User not found");

        assertThat(ex.getErrorCode()).isEqualTo(ErrorCode.NOT_FOUND);
        assertThat(ex.getMessage()).isEqualTo("User not found");
    }

    @Test
    void constructor_withErrorCodeAndCause_wrapsThrowable() {
        RuntimeException cause = new RuntimeException("root cause");

        ApiException ex = new ApiException(ErrorCode.INTERNAL_ERROR, cause);

        assertThat(ex.getErrorCode()).isEqualTo(ErrorCode.INTERNAL_ERROR);
        assertThat(ex.getCause()).isSameAs(cause);
        assertThat(ex.getMessage()).isEqualTo(ErrorCode.INTERNAL_ERROR.defaultMessage());
    }

    @Test
    void isRuntimeException() {
        assertThat(new ApiException(ErrorCode.INVALID_CREDENTIALS)).isInstanceOf(RuntimeException.class);
    }
}
