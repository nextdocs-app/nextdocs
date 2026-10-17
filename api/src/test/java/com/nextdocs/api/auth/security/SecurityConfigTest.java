package com.nextdocs.api.auth.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.head;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.nextdocs.api.attachment.controller.AttachmentController;
import com.nextdocs.api.document.controller.DocumentIconController;
import com.nextdocs.api.workspace.controller.InstanceController;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;

@WebMvcTest(SecurityConfigTest.AttachmentProbeController.class)
@Import({
    SecurityConfigTest.AttachmentProbeController.class,
    com.nextdocs.api.auth.security.SecurityConfig.class,
    com.nextdocs.api.common.cache.CaffeineCacheStore.class,
    com.nextdocs.api.auth.security.ratelimit.InMemoryRateLimiter.class
})
class SecurityConfigTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private JwtTokenProvider jwtTokenProvider;

    @MockitoBean
    private WorkspaceMemberRepository memberRepository;

    @Test
    @DisplayName("Anonymous callers reach the signed attachment endpoints without a 401")
    void publicPaths_permitAnonymousAttachmentRequests() throws Exception {
        mockMvc.perform(get(AttachmentController.URL_PATH, UUID.randomUUID())).andExpect(status().isOk());
        mockMvc.perform(get(AttachmentController.FILE_PATH, UUID.randomUUID())
                        .param("exp", "4102444800")
                        .param("sig", "probe"))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("Anonymous HEAD requests reach the signed attachment endpoints for media probing")
    void publicPaths_permitAnonymousAttachmentHeadRequests() throws Exception {
        mockMvc.perform(head(AttachmentController.URL_PATH, UUID.randomUUID())).andExpect(status().isOk());
        mockMvc.perform(head(AttachmentController.FILE_PATH, UUID.randomUUID())
                        .param("exp", "4102444800")
                        .param("sig", "probe"))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("Anonymous POSTs to the signed attachment endpoints are rejected, not permitted")
    void publicPaths_rejectAnonymousAttachmentPosts() throws Exception {
        // Only GET|HEAD are public: a method-agnostic permitAll would let these through
        // to a 405 instead of the security chain's 401.
        mockMvc.perform(post(AttachmentController.URL_PATH, UUID.randomUUID())).andExpect(status().isUnauthorized());
        mockMvc.perform(post(AttachmentController.FILE_PATH, UUID.randomUUID())
                        .param("exp", "4102444800")
                        .param("sig", "probe"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("Anonymous uploads are rejected: only signed GETs are public")
    void publicPaths_rejectAnonymousUpload() throws Exception {
        // The upload route must NOT be in the public-path list. Asserting the anonymous
        // 401 here catches a permitAll regression that the signed-GET probe cannot see.
        mockMvc.perform(post(AttachmentController.UPLOAD_PATH, UUID.randomUUID()))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("Anonymous callers reach the builtin icon catalog and glyphs without a 401")
    void publicPaths_permitAnonymousIconRequests() throws Exception {
        mockMvc.perform(get(DocumentIconController.LIST_PATH)).andExpect(status().isOk());
        mockMvc.perform(get(DocumentIconController.BUNDLE_PATH)).andExpect(status().isOk());
        mockMvc.perform(get(DocumentIconController.SVG_PATH, "home")).andExpect(status().isOk());
    }

    @Test
    @DisplayName("Anonymous writes to the icon endpoints are rejected for every write method")
    void publicPaths_rejectAnonymousIconWrites() throws Exception {
        // Only GET|HEAD are public: a method-agnostic permitAll would let a future
        // write endpoint under /icons/* through to a 405 instead of a 401. Every
        // write method is probed — pinning only POST lets a regression that
        // allowlists PUT/PATCH/DELETE one method at a time stay green.
        for (String path : new String[] {DocumentIconController.LIST_PATH, DocumentIconController.BUNDLE_PATH}) {
            mockMvc.perform(post(path)).andExpect(status().isUnauthorized());
            mockMvc.perform(put(path)).andExpect(status().isUnauthorized());
            mockMvc.perform(patch(path)).andExpect(status().isUnauthorized());
            mockMvc.perform(delete(path)).andExpect(status().isUnauthorized());
        }
        mockMvc.perform(post(DocumentIconController.SVG_PATH, "home")).andExpect(status().isUnauthorized());
        mockMvc.perform(put(DocumentIconController.SVG_PATH, "home")).andExpect(status().isUnauthorized());
        mockMvc.perform(patch(DocumentIconController.SVG_PATH, "home")).andExpect(status().isUnauthorized());
        mockMvc.perform(delete(DocumentIconController.SVG_PATH, "home")).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("Anonymous callers reach the onboarding read without a 401")
    void publicPaths_permitAnonymousOnboardingReads() throws Exception {
        mockMvc.perform(get(InstanceController.STATUS_PATH)).andExpect(status().isOk());
        mockMvc.perform(head(InstanceController.STATUS_PATH)).andExpect(status().isOk());
    }

    @Test
    @DisplayName("Anonymous writes to the onboarding path are rejected for every write method")
    void publicPaths_rejectAnonymousOnboardingWrites() throws Exception {
        // Only GET|HEAD are public: the register screen reads the instance status, it
        // never writes it, and a method-agnostic permitAll would open whatever write
        // endpoint a future route adds under the path.
        mockMvc.perform(post(InstanceController.STATUS_PATH)).andExpect(status().isUnauthorized());
        mockMvc.perform(put(InstanceController.STATUS_PATH)).andExpect(status().isUnauthorized());
        mockMvc.perform(patch(InstanceController.STATUS_PATH)).andExpect(status().isUnauthorized());
        mockMvc.perform(delete(InstanceController.STATUS_PATH)).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("Anonymous callers reach the invitation preview without a 401")
    void publicPaths_permitAnonymousInvitePreview() throws Exception {
        mockMvc.perform(post("/api/v1/auth/invite/preview")).andExpect(status().isOk());
    }

    @Test
    @DisplayName("Anonymous callers are still rejected on non-public endpoints")
    void publicPaths_rejectAnonymousPrivateRequests() throws Exception {
        mockMvc.perform(get("/api/v1/probe/private")).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("CORS checkOrigin allows exact matches and valid IPv4 LAN origins while rejecting evil domains")
    void corsConfigurationSource_validatesOriginsCorrectly() {
        SecurityConfig config = new SecurityConfig(null, null, null);
        org.springframework.test.util.ReflectionTestUtils.setField(
                config,
                "allowedOrigins",
                "http://localhost:3000,http://127.0.0.1:3000,http://192.168.*.*:3000,http://10.*.*.*:3000,http://172.16.*.*:3000");

        CorsConfigurationSource source = config.corsConfigurationSource();
        MockHttpServletRequest request = new MockHttpServletRequest();
        CorsConfiguration corsConfig = source.getCorsConfiguration(request);
        assertThat(corsConfig).isNotNull();

        // Cross-origin media seeking: Range must be allowed inbound and the range response
        // headers readable, or <video>/<audio> cannot seek from another origin.
        assertThat(corsConfig.getAllowedMethods()).contains("HEAD");
        assertThat(corsConfig.getAllowedHeaders()).contains("Range");
        assertThat(corsConfig.getExposedHeaders()).contains("Accept-Ranges", "Content-Range");

        // Exact matches
        assertThat(corsConfig.checkOrigin("http://localhost:3000")).isEqualTo("http://localhost:3000");
        assertThat(corsConfig.checkOrigin("http://127.0.0.1:3000")).isEqualTo("http://127.0.0.1:3000");

        // Valid LAN IPs
        assertThat(corsConfig.checkOrigin("http://192.168.1.50:3000")).isEqualTo("http://192.168.1.50:3000");
        assertThat(corsConfig.checkOrigin("http://10.0.0.1:3000")).isEqualTo("http://10.0.0.1:3000");
        assertThat(corsConfig.checkOrigin("http://172.16.2.10:3000")).isEqualTo("http://172.16.2.10:3000");

        // Malicious domain origins attempting to match wildcard IP prefix
        assertThat(corsConfig.checkOrigin("http://192.168.evil.com:3000")).isNull();
        assertThat(corsConfig.checkOrigin("http://10.evil.com:3000")).isNull();
        assertThat(corsConfig.checkOrigin("http://172.16.evil.com:3000")).isNull();
        assertThat(corsConfig.checkOrigin("http://evil192.168.1.1:3000")).isNull();
        assertThat(corsConfig.checkOrigin("http://192.168.1.1.evil.com:3000")).isNull();

        // Unallowed numbers or origins
        assertThat(corsConfig.checkOrigin("http://192.168.999.1:3000")).isNull();
        assertThat(corsConfig.checkOrigin("http://example.com:3000")).isNull();
        assertThat(corsConfig.checkOrigin(null)).isNull();
    }

    /** Probe endpoints mirroring the attachment URL shapes so the test exercises the security chain. */
    @RestController
    static class AttachmentProbeController {

        @GetMapping(AttachmentController.URL_PATH)
        String attachmentUrl(@PathVariable String id) {
            return "ok";
        }

        @GetMapping(AttachmentController.FILE_PATH)
        String attachmentFile(@PathVariable String id) {
            return "ok";
        }

        @PostMapping(AttachmentController.UPLOAD_PATH)
        String attachmentUpload(@PathVariable String documentId) {
            return "ok";
        }

        @GetMapping(DocumentIconController.LIST_PATH)
        String iconList() {
            return "ok";
        }

        @GetMapping(DocumentIconController.BUNDLE_PATH)
        String iconBundle() {
            return "ok";
        }

        @GetMapping(DocumentIconController.SVG_PATH)
        String iconSvg(@PathVariable String name) {
            return "ok";
        }

        @GetMapping(InstanceController.STATUS_PATH)
        String instanceStatus() {
            return "ok";
        }

        @PostMapping("/api/v1/auth/invite/preview")
        String invitePreview() {
            return "ok";
        }

        @GetMapping("/api/v1/probe/private")
        String privateProbe() {
            return "ok";
        }
    }
}
