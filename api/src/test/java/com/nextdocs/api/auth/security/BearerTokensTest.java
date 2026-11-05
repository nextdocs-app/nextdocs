package com.nextdocs.api.auth.security;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class BearerTokensTest {

    @ParameterizedTest
    @ValueSource(
            strings = {
                "Bearer token",
                "bearer token",
                "BEARER token",
                "Bearer\ttoken",
                "Bearer",
                "bearer",
                "   bearer",
                "  Bearer \t token"
            })
    void rejectInvalidBearer_rejectsAnyBearerScheme(String header) {
        assertThatThrownBy(() -> BearerTokens.rejectInvalidBearer(header))
                .isInstanceOf(ApiException.class)
                .extracting(ex -> ((ApiException) ex).getErrorCode())
                .isEqualTo(ErrorCode.TOKEN_INVALID);
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "Basic abc", "BearerToken 123", "bearerx 456", "Token Bearer"})
    void rejectInvalidBearer_acceptsOtherSchemesAndNonBearerPrefixes(String header) {
        assertThatCode(() -> BearerTokens.rejectInvalidBearer(header)).doesNotThrowAnyException();
    }

    @Test
    void rejectInvalidBearer_acceptsNull() {
        assertThatCode(() -> BearerTokens.rejectInvalidBearer(null)).doesNotThrowAnyException();
    }
}
