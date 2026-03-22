package com.nextdocs.api.common.exception;

import org.springframework.http.HttpStatus;

public enum ErrorCode {

    // Auth
    INVALID_CREDENTIALS(HttpStatus.UNAUTHORIZED, "Invalid email or password."),
    EMAIL_ALREADY_EXISTS(HttpStatus.CONFLICT, "An account with this email already exists."),
    ACCOUNT_DISABLED(HttpStatus.FORBIDDEN, "This account has been disabled."),
    TOKEN_INVALID(HttpStatus.UNAUTHORIZED, "Token is invalid or expired."),
    TOKEN_MISSING(HttpStatus.UNAUTHORIZED, "Authentication token is required."),
    REFRESH_TOKEN_INVALID(HttpStatus.UNAUTHORIZED, "Refresh token is invalid or expired."),

    // General
    VALIDATION_FAILED(HttpStatus.BAD_REQUEST, "Request validation failed."),
    NOT_FOUND(HttpStatus.NOT_FOUND, "The requested resource was not found."),
    FORBIDDEN(HttpStatus.FORBIDDEN, "You do not have permission to perform this action."),
    CONFLICT(HttpStatus.CONFLICT, "The request conflicts with the current state of the resource."),
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "An unexpected error occurred."),
    RATE_LIMIT_EXCEEDED(HttpStatus.TOO_MANY_REQUESTS, "Too many requests. Please try again later.");

    private final HttpStatus httpStatus;
    private final String defaultMessage;

    ErrorCode(HttpStatus httpStatus, String defaultMessage) {
        this.httpStatus = httpStatus;
        this.defaultMessage = defaultMessage;
    }

    public HttpStatus httpStatus() {
        return httpStatus;
    }

    public String defaultMessage() {
        return defaultMessage;
    }
}
