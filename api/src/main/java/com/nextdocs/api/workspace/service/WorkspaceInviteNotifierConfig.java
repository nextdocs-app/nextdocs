package com.nextdocs.api.workspace.service;

import java.util.concurrent.Executor;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Condition;
import org.springframework.context.annotation.ConditionContext;
import org.springframework.context.annotation.Conditional;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.type.AnnotatedTypeMetadata;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * Chooses how invitation notices travel: over SMTP when a relay is configured, and a
 * notifier that refuses delivery otherwise.
 *
 * <p>Invitations exist only as emails — the API never returns the signup link — so
 * without a relay the service has nowhere to send them and answers 503. A relay counts
 * as configured only when the host has content, because container runs pass an empty
 * `SPRING_MAIL_HOST` through when nothing is set. The fallback is
 * a bean method below the SMTP one on purpose: a missing-bean condition only sees
 * definitions registered so far, and bean methods of one configuration class are
 * registered in declaration order. A scanned {@code @Component} fallback would make the
 * choice depend on scan order instead.
 */
@Configuration
public class WorkspaceInviteNotifierConfig {

    /**
     * SMTP sends outlive the request that queued them, so they get their own bounded
     * pool: a slow relay starves neither HTTP workers nor unrelated background tasks.
     * The queue absorbs a full invite batch (capped at 20 addresses) arriving while both
     * workers are still timing out on the previous one.
     */
    @Bean
    @Conditional(MailRelayConfigured.class)
    public ThreadPoolTaskExecutor inviteMailExecutor(@Value("${app.mail.invite-send-workers:2}") int workers) {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(workers);
        executor.setMaxPoolSize(workers);
        executor.setQueueCapacity(200);
        executor.setThreadNamePrefix("invite-mail-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(30);
        return executor;
    }

    @Bean
    @Conditional(MailRelayConfigured.class)
    public SmtpWorkspaceInviteNotifier smtpWorkspaceInviteNotifier(
            JavaMailSender mailSender,
            @Value("${app.mail.from}") String from,
            @Qualifier("inviteMailExecutor") Executor inviteMailExecutor) {
        return new SmtpWorkspaceInviteNotifier(mailSender, from, inviteMailExecutor);
    }

    @Bean
    @ConditionalOnMissingBean(WorkspaceInviteNotifier.class)
    public MailDisabledWorkspaceInviteNotifier mailDisabledWorkspaceInviteNotifier() {
        return new MailDisabledWorkspaceInviteNotifier();
    }

    /**
     * Matches only a relay host with content. `@ConditionalOnProperty` reads an empty
     * value as present, which would wire an SMTP sender pointed at nowhere.
     */
    static final class MailRelayConfigured implements Condition {

        @Override
        public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
            String host = context.getEnvironment().getProperty("spring.mail.host", "");
            return !host.isBlank();
        }
    }
}
