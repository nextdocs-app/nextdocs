package com.nextdocs.api.auth.security;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;

class SecurityConfigTest {

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
}
