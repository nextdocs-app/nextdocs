package com.nextdocs.api.common.exception;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.nextdocs.api.common.response.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.*;

class GlobalExceptionHandlerTest {

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.standaloneSetup(new TestController())
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    @Test
    void apiException_returnsCorrectStatusAndErrorMessage() throws Exception {
        mockMvc.perform(get("/test/api-exception"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error").value(ErrorCode.INVALID_CREDENTIALS.defaultMessage()));
    }

    @Test
    void apiException_409conflict_returnsConflictStatus() throws Exception {
        mockMvc.perform(get("/test/email-exists"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value(ErrorCode.EMAIL_ALREADY_EXISTS.defaultMessage()));
    }

    @Test
    void accessDeniedException_returns403() throws Exception {
        mockMvc.perform(get("/test/access-denied"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error").value("Access denied."));
    }

    @Test
    void unexpectedException_returns500() throws Exception {
        mockMvc.perform(get("/test/unexpected"))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error").value(ErrorCode.INTERNAL_ERROR.defaultMessage()));
    }

    @Test
    void validationException_returns400WithValidationMessage() throws Exception {
        mockMvc.perform(post("/test/validate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                        {
                            "email": "bad-email",
                            "name": ""
                        }
                        """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error").value(ErrorCode.VALIDATION_FAILED.defaultMessage()))
                .andExpect(jsonPath("$.message").isNotEmpty());
    }

    @Test
    void validationException_missingBody_returns400() throws Exception {
        mockMvc.perform(post("/test/validate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                        {
                            "email": "",
                            "name": ""
                        }
                        """))
                .andExpect(status().isBadRequest());
    }

    @Test
    void typeMismatchException_returns400WithValidationError() throws Exception {
        mockMvc.perform(get("/test/type-mismatch/default-doc"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error").value(ErrorCode.VALIDATION_FAILED.defaultMessage()))
                .andExpect(jsonPath("$.message").value("id must be a valid UUID."));
    }

    @RestController
    @RequestMapping("/test")
    static class TestController {

        @GetMapping("/api-exception")
        ResponseEntity<ApiResponse<Void>> apiException() {
            throw new ApiException(ErrorCode.INVALID_CREDENTIALS);
        }

        @GetMapping("/email-exists")
        ResponseEntity<ApiResponse<Void>> emailExists() {
            throw new ApiException(ErrorCode.EMAIL_ALREADY_EXISTS);
        }

        @GetMapping("/access-denied")
        ResponseEntity<ApiResponse<Void>> accessDenied() {
            throw new AccessDeniedException("not allowed");
        }

        @GetMapping("/unexpected")
        ResponseEntity<ApiResponse<Void>> unexpected() {
            throw new RuntimeException("unexpected failure");
        }

        @PostMapping("/validate")
        ResponseEntity<ApiResponse<String>> validate(@Valid @RequestBody ValidatedBody body) {
            return ResponseEntity.ok(ApiResponse.ok("ok"));
        }

        @GetMapping("/type-mismatch/{id}")
        ResponseEntity<ApiResponse<String>> typeMismatch(@PathVariable UUID id) {
            return ResponseEntity.ok(ApiResponse.ok(id.toString()));
        }

        record ValidatedBody(
                @NotBlank @Email String email, @NotBlank String name) {}
    }
}
