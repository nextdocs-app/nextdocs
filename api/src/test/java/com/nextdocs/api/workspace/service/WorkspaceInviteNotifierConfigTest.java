package com.nextdocs.api.workspace.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.mail.javamail.JavaMailSender;

/**
 * Pins the delivery choice: exactly one notifier bean, SMTP only when a relay host is
 * configured, a notifier that refuses delivery otherwise.
 */
class WorkspaceInviteNotifierConfigTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(WorkspaceInviteNotifierConfig.class)
            .withBean(JavaMailSender.class, () -> mock(JavaMailSender.class));

    @Test
    void withoutAMailHost_deliveryIsUnavailable() {
        runner.run(context -> {
            assertThat(context).hasSingleBean(WorkspaceInviteNotifier.class);
            WorkspaceInviteNotifier notifier = context.getBean(WorkspaceInviteNotifier.class);
            assertThat(notifier).isInstanceOf(MailDisabledWorkspaceInviteNotifier.class);
            assertThat(notifier.isDeliveryConfigured()).isFalse();
        });
    }

    @Test
    void withABlankMailHost_deliveryIsUnavailable() {
        // Container runs pass SPRING_MAIL_HOST through as an empty value when no
        // relay is configured; that must not count as a relay.
        runner.withPropertyValues("spring.mail.host=").run(context -> {
            assertThat(context).hasSingleBean(WorkspaceInviteNotifier.class);
            assertThat(context.getBean(WorkspaceInviteNotifier.class))
                    .isInstanceOf(MailDisabledWorkspaceInviteNotifier.class);
            assertThat(context).doesNotHaveBean("inviteMailExecutor");
        });
    }

    @Test
    void withAMailHost_deliveryIsConfiguredOverSmtp() {
        runner.withPropertyValues("spring.mail.host=smtp.example.com", "app.mail.from=NextDocs <no-reply@example.com>")
                .run(context -> {
                    assertThat(context).hasSingleBean(WorkspaceInviteNotifier.class);
                    WorkspaceInviteNotifier notifier = context.getBean(WorkspaceInviteNotifier.class);
                    assertThat(notifier).isInstanceOf(SmtpWorkspaceInviteNotifier.class);
                    assertThat(notifier.isDeliveryConfigured()).isTrue();
                });
    }

    @Test
    void withAMailHost_configuresGracefulShutdownOnTheInviteExecutor() {
        runner.withPropertyValues("spring.mail.host=smtp.example.com", "app.mail.from=NextDocs <no-reply@example.com>")
                .run(context -> {
                    assertThat(context).hasBean("inviteMailExecutor");
                    org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor executor =
                            (org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor)
                                    context.getBean("inviteMailExecutor");
                    assertThat(org.springframework.test.util.ReflectionTestUtils.getField(
                                    executor, "waitForTasksToCompleteOnShutdown"))
                            .isEqualTo(true);
                    assertThat(org.springframework.test.util.ReflectionTestUtils.getField(
                                    executor, "awaitTerminationMillis"))
                            .isEqualTo(30000L);
                });
    }
}
