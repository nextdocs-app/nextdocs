package com.nextdocs.api.common.exception;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.http.HttpStatus;

class ErrorCodeTest {

    @Test
    void invalidCredentials_maps401() {
        assertThat(ErrorCode.INVALID_CREDENTIALS.httpStatus()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void emailAlreadyExists_maps409() {
        assertThat(ErrorCode.EMAIL_ALREADY_EXISTS.httpStatus()).isEqualTo(HttpStatus.CONFLICT);
    }

    @Test
    void accountDisabled_maps403() {
        assertThat(ErrorCode.ACCOUNT_DISABLED.httpStatus()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void tokenInvalid_maps401() {
        assertThat(ErrorCode.TOKEN_INVALID.httpStatus()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void tokenMissing_maps401() {
        assertThat(ErrorCode.TOKEN_MISSING.httpStatus()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void refreshTokenInvalid_maps401() {
        assertThat(ErrorCode.REFRESH_TOKEN_INVALID.httpStatus()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void validationFailed_maps400() {
        assertThat(ErrorCode.VALIDATION_FAILED.httpStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    void notFound_maps404() {
        assertThat(ErrorCode.NOT_FOUND.httpStatus()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void internalError_maps500() {
        assertThat(ErrorCode.INTERNAL_ERROR.httpStatus()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
    }

    @Test
    void rateLimitExceeded_maps429() {
        assertThat(ErrorCode.RATE_LIMIT_EXCEEDED.httpStatus()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
    }

    @ParameterizedTest
    @EnumSource(ErrorCode.class)
    void allErrorCodes_haveNonBlankDefaultMessage(ErrorCode code) {
        assertThat(code.defaultMessage()).isNotBlank();
    }

    @ParameterizedTest
    @EnumSource(ErrorCode.class)
    void allErrorCodes_haveHttpStatus(ErrorCode code) {
        assertThat(code.httpStatus()).isNotNull();
    }
}
