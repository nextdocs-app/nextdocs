package com.nextdocs.api.common.response;

import java.time.Instant;
import lombok.Getter;

// Uniform envelope for every HTTP response body.
@Getter
public class ApiResponse<T> {

    private final boolean success;
    private final T data;
    private final String error;
    private final String message;
    private final Instant timestamp;

    private ApiResponse(boolean success, T data, String error, String message) {
        this.success = success;
        this.data = data;
        this.error = error;
        this.message = message;
        this.timestamp = Instant.now();
    }

    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(true, data, null, null);
    }

    public static <T> ApiResponse<T> ok(T data, String message) {
        return new ApiResponse<>(true, data, null, message);
    }

    public static <T> ApiResponse<T> error(String error) {
        return new ApiResponse<>(false, null, error, null);
    }

    public static <T> ApiResponse<T> error(String error, String message) {
        return new ApiResponse<>(false, null, error, message);
    }
}
