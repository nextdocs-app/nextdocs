package com.nextdocs.api.config;

import jakarta.annotation.PostConstruct;
import java.net.URI;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Fails startup on configuration that would otherwise surface as broken links, invites
 * that never work, or a mail executor that cannot start.
 */
@Component
public class StartupConfigValidator {

    @Value("${app.workspace.invite-expiry-days}")
    private long inviteExpiryDays;

    @Value("${app.workspace.expired-invite-retention-days:30}")
    private long expiredInviteRetentionDays;

    @Value("${app.mail.invite-send-workers:2}")
    private int inviteSendWorkers;

    @Value("${app.web.base-url}")
    private String webBaseUrl;

    @PostConstruct
    void validate() {
        if (inviteExpiryDays <= 0) {
            throw new IllegalStateException("app.workspace.invite-expiry-days must be greater than zero");
        }
        if (expiredInviteRetentionDays <= 0) {
            throw new IllegalStateException("app.workspace.expired-invite-retention-days must be greater than zero");
        }
        if (inviteSendWorkers <= 0) {
            throw new IllegalStateException("app.mail.invite-send-workers must be greater than zero");
        }
        URI baseUrl;
        try {
            baseUrl = URI.create(webBaseUrl);
        } catch (IllegalArgumentException ex) {
            throw new IllegalStateException("app.web.base-url must be an absolute URL", ex);
        }
        if (!baseUrl.isAbsolute()
                || baseUrl.getHost() == null
                || !("http".equalsIgnoreCase(baseUrl.getScheme()) || "https".equalsIgnoreCase(baseUrl.getScheme()))) {
            throw new IllegalStateException("app.web.base-url must be an absolute http(s) URL");
        }
    }
}
