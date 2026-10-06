package com.nextdocs.api.auth.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.nextdocs.api.auth.security.ratelimit.RateLimiter;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

class RateLimitFilterTest {

    /** Small ceiling so body-limit tests stay cheap; the production default is 5 MB. */
    private static final long MAX_TEST_BODY_BYTES = 1024;

    private MockMvc mockMvc;
    private StubRateLimiter rateLimiter;
    private RateLimitFilter filter;

    @BeforeEach
    void setUp() {
        rateLimiter = new StubRateLimiter();
        filter = new RateLimitFilter(rateLimiter, new ObjectMapper(), 120, 60, 20, 60, MAX_TEST_BODY_BYTES);
        mockMvc = MockMvcBuilders.standaloneSetup(new StubController())
                .addFilters(filter)
                .build();
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void authPath_whenAllowed_isPassedThrough() throws Exception {
        mockMvc.perform(post("/api/v1/auth/login").remoteAddress("10.0.0.1")).andExpect(status().isOk());

        assertThat(rateLimiter.invocationCount).isEqualTo(1);
        assertThat(rateLimiter.lastKey).isEqualTo("auth:10.0.0.1");
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
    void publicDocumentPath_whenAllowed_isPassedThrough() throws Exception {
        mockMvc.perform(get("/api/v1/documents/{id}/public", "11111111-1111-1111-1111-111111111111")
                        .remoteAddress("10.0.0.4"))
                .andExpect(status().isOk());

        assertThat(rateLimiter.invocationCount).isEqualTo(1);
        assertThat(rateLimiter.lastKey).isEqualTo("public-read:10.0.0.4");
    }

    @Test
    void publicDocumentPath_whenRejected_returnsTooManyRequests() throws Exception {
        rateLimiter.allowed = false;

        mockMvc.perform(get("/api/v1/documents/{id}/public", "11111111-1111-1111-1111-111111111111")
                        .remoteAddress("10.0.0.5"))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string("Retry-After", "60"))
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    void publicDocumentPath_withEncodedSlashInId_isNotRateLimited() throws Exception {
        mockMvc.perform(get("/api/v1/documents/11111111-1111-1111-1111-111111111111%2Fchild/public")
                        .remoteAddress("10.0.0.6"))
                .andReturn();

        assertThat(rateLimiter.invocationCount).isZero();
    }

    @Test
    void publicSubPaths_areRateLimited() throws Exception {
        String id = "11111111-1111-1111-1111-111111111111";

        mockMvc.perform(get("/api/v1/documents/{id}/public/path", id).remoteAddress("10.0.1.1"))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/documents/{id}/public/children", id).remoteAddress("10.0.1.1"))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/documents/{id}/access-check", id).remoteAddress("10.0.1.1"))
                .andExpect(status().isOk());
        mockMvc.perform(patch("/api/v1/documents/{id}/public", id)
                        .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                        .content("{}")
                        .remoteAddress("10.0.1.1"))
                .andExpect(status().isOk());

        assertThat(rateLimiter.invocationCount).isEqualTo(4);
        assertThat(rateLimiter.lastKey).isEqualTo("public-write:10.0.1.1");
        assertThat(rateLimiter.lastMaxRequests).isEqualTo(20);
    }

    @Test
    void publicReadPaths_shareOneReadBucket() throws Exception {
        String id = "11111111-1111-1111-1111-111111111111";

        mockMvc.perform(get("/api/v1/documents/{id}/public/path", id).remoteAddress("10.0.1.5"))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/documents/{id}/public/children", id).remoteAddress("10.0.1.5"))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/documents/{id}/access-check", id).remoteAddress("10.0.1.5"))
                .andExpect(status().isOk());

        assertThat(rateLimiter.invocationCount).isEqualTo(3);
        assertThat(rateLimiter.lastKey).isEqualTo("public-read:10.0.1.5");
        assertThat(rateLimiter.lastMaxRequests).isEqualTo(120);
    }

    @Test
    void accessCheck_whenAuthenticated_isNotRateLimited() throws Exception {
        String id = "11111111-1111-1111-1111-111111111111";

        com.nextdocs.api.auth.entity.User user = com.nextdocs.api.auth.entity.User.builder()
                .id(UUID.randomUUID())
                .email("user@example.com")
                .displayName("Test User")
                .passwordHash("hash")
                .active(true)
                .build();
        UserPrincipal principal = UserPrincipal.from(user);
        SecurityContextHolder.getContext()
                .setAuthentication(new UsernamePasswordAuthenticationToken(principal, null, List.of()));

        // Identified callers are exempt so an owner's polling tab cannot starve
        // guests sharing the same egress IP.
        mockMvc.perform(get("/api/v1/documents/{id}/access-check", id).remoteAddress("10.0.1.4"))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/documents/{id}/my-access", id).remoteAddress("10.0.1.4"))
                .andExpect(status().isOk());

        assertThat(rateLimiter.invocationCount).isZero();
    }

    @Test
    void accessCheck_withGarbageAuthorizationHeader_isRateLimited() throws Exception {
        String id = "11111111-1111-1111-1111-111111111111";

        // Bearer garbage without a valid UserPrincipal in SecurityContext must NOT bypass rate limiting
        mockMvc.perform(get("/api/v1/documents/{id}/access-check", id)
                        .header("Authorization", "Bearer invalid-garbage-token")
                        .remoteAddress("10.0.1.4"))
                .andExpect(status().isOk());

        assertThat(rateLimiter.invocationCount).isEqualTo(1);
        assertThat(rateLimiter.lastKey).isEqualTo("public-read:10.0.1.4");
        assertThat(rateLimiter.lastMaxRequests).isEqualTo(120);
        assertThat(rateLimiter.lastWindow).isEqualTo(Duration.ofSeconds(60));
    }

    @Test
    void trailingSlashPaths_areCorrectlyClassified() throws Exception {
        String id = "11111111-1111-1111-1111-111111111111";

        mockMvc.perform(get("/api/v1/documents/" + id + "/public/").remoteAddress("10.0.1.8"));
        assertThat(rateLimiter.lastKey).isEqualTo("public-read:10.0.1.8");

        mockMvc.perform(patch("/api/v1/documents/" + id + "/public/")
                .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                .content("{}")
                .remoteAddress("10.0.1.8"));
        assertThat(rateLimiter.lastKey).isEqualTo("public-write:10.0.1.8");

        mockMvc.perform(get("/api/v1/documents/" + id + "/access-check/").remoteAddress("10.0.1.8"));
        assertThat(rateLimiter.lastKey).isEqualTo("public-read:10.0.1.8");

        mockMvc.perform(get("/api/v1/documents/" + id + "/public/path/").remoteAddress("10.0.1.8"));
        assertThat(rateLimiter.lastKey).isEqualTo("public-read:10.0.1.8");

        mockMvc.perform(get("/api/v1/documents/" + id + "/public/children/").remoteAddress("10.0.1.8"));
        assertThat(rateLimiter.lastKey).isEqualTo("public-read:10.0.1.8");
    }

    @Test
    void anonymousWrite_withOversizedBody_isRejectedBeforeParsing() throws Exception {
        String id = "11111111-1111-1111-1111-111111111111";

        mockMvc.perform(patch("/api/v1/documents/{id}/public", id)
                        .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                        .content("x".repeat((int) MAX_TEST_BODY_BYTES + 1))
                        .remoteAddress("10.0.2.1"))
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.success").value(false));

        // The budget is consumed first, so oversized bodies cannot be used to probe
        // the endpoint for free.
        assertThat(rateLimiter.invocationCount).isEqualTo(1);
        assertThat(rateLimiter.lastKey).isEqualTo("public-write:10.0.2.1");
    }

    @Test
    void readPaths_areNotSubjectToTheBodyLimit() throws Exception {
        String id = "11111111-1111-1111-1111-111111111111";

        mockMvc.perform(get("/api/v1/documents/{id}/public", id).remoteAddress("10.0.2.2"))
                .andExpect(status().isOk());

        assertThat(rateLimiter.lastKey).isEqualTo("public-read:10.0.2.2");
    }

    @Test
    void ipv4MappedIpv6_isNormalized() throws Exception {
        String id = "11111111-1111-1111-1111-111111111111";
        mockMvc.perform(get("/api/v1/documents/{id}/public", id).remoteAddress("::ffff:10.0.1.9"))
                .andExpect(status().isOk());

        assertThat(rateLimiter.lastKey).isEqualTo("public-read:10.0.1.9");
    }

    @Test
    void publicNestedPath_isNotRateLimited() throws Exception {
        mockMvc.perform(get("/api/v1/documents/11111111-1111-1111-1111-111111111111/public/children/extra")
                        .remoteAddress("10.0.1.2"))
                .andReturn();

        assertThat(rateLimiter.invocationCount).isZero();
    }

    @Test
    void xForwardedForHeader_isIgnored_whenRemoteAddressIsNotTrustedProxy() throws Exception {
        // No trusted proxies configured (default) — X-Forwarded-For must not be trusted
        mockMvc.perform(post("/api/v1/auth/login")
                        .header("X-Forwarded-For", "203.0.113.5, 10.0.0.1")
                        .remoteAddress("10.0.0.1"))
                .andExpect(status().isOk());

        assertThat(rateLimiter.lastKey).isEqualTo("auth:10.0.0.1");
    }

    @Test
    void xForwardedForHeader_usesRightmostUntrustedHop_whenRemoteAddressIsTrustedProxy() throws Exception {
        // Configure 10.0.0.1 as a trusted proxy so X-Forwarded-For is honoured
        ReflectionTestUtils.setField(filter, "trustedProxiesRaw", "10.0.0.1");
        filter.initTrustedProxies();

        // Typical chain: the client, then the trusted hop that appended its own address.
        mockMvc.perform(post("/api/v1/auth/login")
                        .header("X-Forwarded-For", "203.0.113.5, 10.0.0.1")
                        .remoteAddress("10.0.0.1"))
                .andExpect(status().isOk());

        assertThat(rateLimiter.lastKey).isEqualTo("auth:203.0.113.5");
    }

    @Test
    void xForwardedForHeader_ignoresClientSuppliedLeadingEntries() throws Exception {
        ReflectionTestUtils.setField(filter, "trustedProxiesRaw", "10.0.0.1");
        filter.initTrustedProxies();

        // The caller prepended 9.9.9.9; the trusted hop appended the real peer address.
        // Rotating the spoofed entry must not hand out a fresh budget per request.
        mockMvc.perform(post("/api/v1/auth/login")
                        .header("X-Forwarded-For", "9.9.9.9, 203.0.113.5")
                        .remoteAddress("10.0.0.1"))
                .andExpect(status().isOk());
        assertThat(rateLimiter.lastKey).isEqualTo("auth:203.0.113.5");

        mockMvc.perform(post("/api/v1/auth/login")
                        .header("X-Forwarded-For", "8.8.8.8, 203.0.113.5")
                        .remoteAddress("10.0.0.1"))
                .andExpect(status().isOk());
        assertThat(rateLimiter.lastKey).isEqualTo("auth:203.0.113.5");
    }

    @Test
    void xForwardedForHeader_fallsBackToPeer_whenEveryHopIsATrustedProxy() throws Exception {
        ReflectionTestUtils.setField(filter, "trustedProxiesRaw", "10.0.0.1, 10.0.0.2");
        filter.initTrustedProxies();

        mockMvc.perform(post("/api/v1/auth/login")
                        .header("X-Forwarded-For", "10.0.0.2, 10.0.0.1")
                        .remoteAddress("10.0.0.1"))
                .andExpect(status().isOk());

        assertThat(rateLimiter.lastKey).isEqualTo("auth:10.0.0.1");
    }

    private static final class StubRateLimiter implements RateLimiter {
        private boolean allowed = true;
        private String lastKey;
        private int lastMaxRequests;
        private Duration lastWindow;
        private int invocationCount;

        @Override
        public boolean allowRequest(String key) {
            invocationCount++;
            lastKey = key;
            return allowed;
        }

        @Override
        public boolean allowRequest(String key, int maxRequests, java.time.Duration window) {
            invocationCount++;
            lastKey = key;
            lastMaxRequests = maxRequests;
            lastWindow = window;
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

        @GetMapping("/api/v1/documents/{id}/public")
        ResponseEntity<String> getPublic(@PathVariable String id) {
            return ResponseEntity.ok("ok");
        }

        @org.springframework.web.bind.annotation.PatchMapping("/api/v1/documents/{id}/public")
        ResponseEntity<String> patchPublic(@PathVariable String id) {
            return ResponseEntity.ok("ok");
        }

        @GetMapping("/api/v1/documents/{id}/public/path")
        ResponseEntity<String> getPublicPath(@PathVariable String id) {
            return ResponseEntity.ok("ok");
        }

        @GetMapping("/api/v1/documents/{id}/public/children")
        ResponseEntity<String> getPublicChildren(@PathVariable String id) {
            return ResponseEntity.ok("ok");
        }

        @GetMapping("/api/v1/documents/{id}/access-check")
        ResponseEntity<String> accessCheck(@PathVariable String id) {
            return ResponseEntity.ok("ok");
        }

        @GetMapping("/api/v1/documents/{id}/my-access")
        ResponseEntity<String> myAccess(@PathVariable String id) {
            return ResponseEntity.ok("ok");
        }
    }
}
