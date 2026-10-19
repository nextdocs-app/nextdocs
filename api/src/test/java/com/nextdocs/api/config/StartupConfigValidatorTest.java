package com.nextdocs.api.config;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class StartupConfigValidatorTest {

    @Test
    void rejectsNonPositiveInviteSettingsAndWorkers() {
        StartupConfigValidator validator = validator();
        ReflectionTestUtils.setField(validator, "inviteExpiryDays", 0L);
        assertThatThrownBy(validator::validate)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("invite-expiry-days");

        validator = validator();
        ReflectionTestUtils.setField(validator, "expiredInviteRetentionDays", 0L);
        assertThatThrownBy(validator::validate)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("expired-invite-retention-days");

        validator = validator();
        ReflectionTestUtils.setField(validator, "inviteSendWorkers", 0);
        assertThatThrownBy(validator::validate)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("invite-send-workers");
    }

    @Test
    void rejectsARelativeWebBaseUrl() {
        StartupConfigValidator validator = validator();
        ReflectionTestUtils.setField(validator, "webBaseUrl", "/join");
        assertThatThrownBy(validator::validate)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("app.web.base-url");
    }

    private static StartupConfigValidator validator() {
        StartupConfigValidator validator = new StartupConfigValidator();
        ReflectionTestUtils.setField(validator, "inviteExpiryDays", 7L);
        ReflectionTestUtils.setField(validator, "expiredInviteRetentionDays", 30L);
        ReflectionTestUtils.setField(validator, "inviteSendWorkers", 2);
        ReflectionTestUtils.setField(validator, "webBaseUrl", "https://docs.example.com");
        return validator;
    }
}
