package com.nextdocs.api.common.exception;

import com.nextdocs.api.common.response.ApiResponse;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ApiResponse<Void>> handleApiException(ApiException ex) {
        // Log server-side detail only for 5xx errors to avoid leaking auth info in logs
        if (ex.getErrorCode().httpStatus().is5xxServerError()) {
            log.error("ApiException [{}]: {}", ex.getErrorCode(), ex.getMessage(), ex);
        } else {
            log.debug("ApiException [{}]: {}", ex.getErrorCode(), ex.getMessage());
        }
        return ResponseEntity.status(ex.getErrorCode().httpStatus())
                .body(ApiResponse.error(ex.getErrorCode().defaultMessage()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> handleValidation(MethodArgumentNotValidException ex) {
        String detail = ex.getBindingResult().getFieldErrors().stream()
                .map(fe -> fe.getField() + ": " + fe.getDefaultMessage())
                .sorted()
                .collect(Collectors.joining("; "));
        log.debug("Validation failed: {}", detail);
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.error(ErrorCode.VALIDATION_FAILED.defaultMessage(), detail));
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ApiResponse<Void>> handleAccessDenied(AccessDeniedException ex) {
        log.warn("Access denied: {}", ex.getMessage(), ex);
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(ApiResponse.error("Access denied."));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleUnexpected(Exception ex) {
        log.error("Unhandled exception", ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiResponse.error(ErrorCode.INTERNAL_ERROR.defaultMessage()));
    }
}
