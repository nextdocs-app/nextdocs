package com.nextdocs.api;

import java.util.Base64;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContextInitializer;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.test.context.ContextConfiguration;

@SpringBootTest
@ContextConfiguration(initializers = NextdocsApiApplicationTests.EarlySystemProperties.class)
class NextdocsApiApplicationTests {

    @Test
    void contextLoads() {}

    /**
     * Sets JVM system properties that must be present before the Spring application
     * context is refreshed. All values here are test-only dummies.
     */
    static class EarlySystemProperties implements ApplicationContextInitializer<ConfigurableApplicationContext> {

        private static final Map<String, String> PROPERTIES = Map.of(
                // AES-256 key required by OAuthTokenAttributeConverter.
                "oauth.token.encryption.key-base64",
                Base64.getEncoder().encodeToString("testkey0testkey0testkey0testkey0".getBytes()));

        @Override
        public void initialize(ConfigurableApplicationContext applicationContext) {
            PROPERTIES.forEach(System::setProperty);
        }
    }
}
