package com.nextdocs.api.attachment.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class AttachmentPropertiesTest {

    @Test
    void maxStoragePerUserBytes_parsesSupportedValues() {
        AttachmentProperties properties = new AttachmentProperties();

        properties.setMaxStoragePerUser("2GB");
        assertThat(properties.maxStoragePerUserBytes()).isEqualTo(2L * 1024 * 1024 * 1024);

        properties.setMaxStoragePerUser("-1");
        assertThat(properties.maxStoragePerUserBytes()).isEqualTo(-1);
    }

    @Test
    void parseMaxStoragePerUser_cachesTheStartupValue() {
        AttachmentProperties properties = new AttachmentProperties();
        properties.setMaxStoragePerUser("512MB");

        properties.parseMaxStoragePerUser();

        assertThat(properties.maxStoragePerUserBytes()).isEqualTo(512L * 1024 * 1024);
    }

    @Test
    void parseMaxStoragePerUser_negativeValue_failsTheContextStart() {
        // A negative limit other than -1 would read as "no limit" in the reserve
        // check (limit >= 0), silently disabling quota enforcement and risking disk-fill.
        AttachmentProperties properties = new AttachmentProperties();
        properties.setMaxStoragePerUser("-5MB");

        assertThatThrownBy(properties::parseMaxStoragePerUser).isInstanceOf(IllegalArgumentException.class);

        properties.setMaxStoragePerUser("-2GB");

        assertThatThrownBy(properties::parseMaxStoragePerUser).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void parseMaxStoragePerUser_malformedValue_failsTheContextStart() {
        // Spring runs this parse as a @PostConstruct, so a typo in the config must throw
        // during startup rather than turning into a 500 on the first upload.
        AttachmentProperties properties = new AttachmentProperties();
        properties.setMaxStoragePerUser("not-a-size");

        assertThatThrownBy(properties::parseMaxStoragePerUser).isInstanceOf(IllegalArgumentException.class);
    }
}
