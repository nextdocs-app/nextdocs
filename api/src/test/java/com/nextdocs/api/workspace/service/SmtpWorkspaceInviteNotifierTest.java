package com.nextdocs.api.workspace.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.entity.WorkspaceInvite;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.internet.MimeMultipart;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import java.util.concurrent.RejectedExecutionException;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.slf4j.LoggerFactory;
import org.springframework.mail.MailSendException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessagePreparator;

class SmtpWorkspaceInviteNotifierTest {

    private static final String INVITATION_URL = "http://localhost:3000/join#token=s3cret-token";

    private final JavaMailSender mailSender = mock(JavaMailSender.class);
    private final SmtpWorkspaceInviteNotifier notifier =
            new SmtpWorkspaceInviteNotifier(mailSender, "NextDocs <no-reply@example.com>", Runnable::run);

    @Test
    void isDeliveryConfigured_isTrue() {
        assertThat(notifier.isDeliveryConfigured()).isTrue();
    }

    @Test
    void inviteIssued_sendsTheLinkToTheInvitedAddress() throws Exception {
        notifier.inviteIssued(invite(), INVITATION_URL);

        MimeMessage message = preparedMessage();
        assertThat(message.getSubject()).isEqualTo("You have been invited to join NextDocs");
        assertThat(message.getFrom()[0].toString()).isEqualTo("NextDocs <no-reply@example.com>");
        assertThat(message.getAllRecipients()[0].toString()).isEqualTo("jane@example.com");
        assertThat(bodyParts(message))
                .hasSize(2)
                .allSatisfy(part -> assertThat(part).contains(INVITATION_URL));
    }

    @Test
    void inviteIssued_stripsControlCharactersFromTheSubject() throws Exception {
        notifier.inviteIssued(invite("Evil\r\nBcc: attacker@example.com"), INVITATION_URL);

        String subject = preparedMessage().getSubject();
        assertThat(subject).isEqualTo("You have been invited to join Evil Bcc: attacker@example.com");
        assertThat(subject).doesNotContain("\r", "\n");
    }

    @Test
    void inviteIssued_whenTheQueueIsFull_dropsTheNoticeWithoutFailingTheCaller() {
        SmtpWorkspaceInviteNotifier overloaded =
                new SmtpWorkspaceInviteNotifier(mailSender, "NextDocs <no-reply@example.com>", command -> {
                    throw new RejectedExecutionException("queue full");
                });

        // The invite row is committed; a full queue must not turn that into a 500.
        assertThatCode(() -> overloaded.inviteIssued(invite(), INVITATION_URL)).doesNotThrowAnyException();
        verify(mailSender, never()).send(any(MimeMessagePreparator.class));
    }

    @Test
    void inviteIssued_whenTheRelayFails_staysQuietAndLogsNoLink() {
        doThrow(new MailSendException("Mail server connection failed"))
                .when(mailSender)
                .send(any(MimeMessagePreparator.class));
        Logger logger = (Logger) LoggerFactory.getLogger(SmtpWorkspaceInviteNotifier.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            assertThatCode(() -> notifier.inviteIssued(invite(), INVITATION_URL))
                    .doesNotThrowAnyException();

            assertThat(appender.list)
                    .anySatisfy(event -> assertThat(event.getFormattedMessage()).contains("jane@example.com"));
            assertThat(appender.list)
                    .allSatisfy(event ->
                            assertThat(event.getFormattedMessage()).doesNotContain(INVITATION_URL, "s3cret-token"));
            assertThat(appender.list)
                    .allSatisfy(event -> assertThat(event.getLevel()).isEqualTo(Level.WARN));
        } finally {
            logger.detachAppender(appender);
        }
    }

    private WorkspaceInvite invite() {
        return invite("NextDocs");
    }

    private WorkspaceInvite invite(String workspaceName) {
        Workspace workspace = Workspace.builder().name(workspaceName).build();
        return WorkspaceInvite.builder()
                .workspace(workspace)
                .email("jane@example.com")
                .role(WorkspaceRole.MEMBER)
                .tokenHash("hash")
                .expiresAt(OffsetDateTime.now().plusDays(7))
                .build();
    }

    /** Runs the preparator the notifier handed to the sender, as a real send would. */
    private MimeMessage preparedMessage() throws Exception {
        ArgumentCaptor<MimeMessagePreparator> preparator = ArgumentCaptor.forClass(MimeMessagePreparator.class);
        verify(mailSender).send(preparator.capture());
        MimeMessage message = new MimeMessage(Session.getInstance(new Properties()));
        preparator.getValue().prepare(message);
        return message;
    }

    private List<String> bodyParts(MimeMessage message) throws Exception {
        return textParts(message.getContent());
    }

    /** Mixed/alternative bodies nest, so collect every text part recursively. */
    private List<String> textParts(Object content) throws Exception {
        List<String> parts = new ArrayList<>();
        if (content instanceof MimeMultipart multipart) {
            for (int i = 0; i < multipart.getCount(); i++) {
                parts.addAll(textParts(multipart.getBodyPart(i).getContent()));
            }
        } else if (content instanceof String text) {
            parts.add(text);
        }
        return parts;
    }
}
