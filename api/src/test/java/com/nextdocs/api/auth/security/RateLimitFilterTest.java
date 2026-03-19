package com.nextdocs.api.auth.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.nextdocs.api.auth.security.ratelimit.RateLimiter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

class RateLimitFilterTest {

    private MockMvc mockMvc;
    private StubRateLimiter rateLimiter;
    private RateLimitFilter filter;

    @BeforeEach
    void setUp() {
        rateLimiter = new StubRateLimiter();
        filter = new RateLimitFilter(rateLimiter, new ObjectMapper());
        mockMvc = MockMvcBuilders.standaloneSetup(new StubController())
                .addFilters(filter)
                .build();
    }

    @Test
    void authPath_whenAllowed_isPassedThrough() throws Exception {
        mockMvc.perform(post("/api/v1/auth/login").remoteAddress("10.0.0.1")).andExpect(status().isOk());

        assertThat(rateLimiter.invocationCount).isEqualTo(1);
        assertThat(rateLimiter.lastKey).isEqualTo("10.0.0.1");
    }

    @Test
    void authPath_whenRejected_returnsTooManyRequests() throws Exception {
        rateLimiter.allowed = false;

        mockMvc.perform(post("/api/v1/auth/login").remoteAddress("10.0.0.2"))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    void nonAuthPath_isNotRateLimited() throws Exception {
        mockMvc.perform(post("/other/endpoint").remoteAddress("10.0.0.3")).andExpect(status().isOk());

        assertThat(rateLimiter.invocationCount).isZero();
    }

    @Test
    void xForwardedForHeader_isIgnored_whenRemoteAddressIsNotTrustedProxy() throws Exception {
        // No trusted proxies configured (default) — X-Forwarded-For must not be trusted
        mockMvc.perform(post("/api/v1/auth/login")
                        .header("X-Forwarded-For", "203.0.113.5, 10.0.0.1")
                        .remoteAddress("10.0.0.1"))
                .andExpect(status().isOk());

        assertThat(rateLimiter.lastKey).isEqualTo("10.0.0.1");
    }

    @Test
    void xForwardedForHeader_usesFirstIp_whenRemoteAddressIsTrustedProxy() throws Exception {
        // Configure 10.0.0.1 as a trusted proxy so X-Forwarded-For is honoured
        ReflectionTestUtils.setField(filter, "trustedProxiesRaw", "10.0.0.1");
        filter.initTrustedProxies();

        mockMvc.perform(post("/api/v1/auth/login")
                        .header("X-Forwarded-For", "203.0.113.5, 10.0.0.1")
                        .remoteAddress("10.0.0.1"))
                .andExpect(status().isOk());

        assertThat(rateLimiter.lastKey).isEqualTo("203.0.113.5");
    }

    private static final class StubRateLimiter implements RateLimiter {
        private boolean allowed = true;
        private String lastKey;
        private int invocationCount;

        @Override
        public boolean allowRequest(String key) {
            invocationCount++;
            lastKey = key;
            return allowed;
        }
    }

    @RestController
    static class StubController {
        @PostMapping("/api/v1/auth/login")
        ResponseEntity<String> login() {
            return ResponseEntity.ok("ok");
        }

        @PostMapping("/other/endpoint")
        ResponseEntity<String> other() {
            return ResponseEntity.ok("ok");
        }
    }
}
