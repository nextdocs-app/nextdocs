package com.nextdocs.api.workspace.service;

import com.nextdocs.api.workspace.entity.WorkspaceInvite;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.mail.MailException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.mail.javamail.MimeMessagePreparator;
import org.springframework.web.util.HtmlUtils;

/**
 * Delivers invitation links over SMTP; the config activates it when
 * {@code spring.mail.host} is set.
 *
 * <p>A failed send never fails the request and never consumes the invite: the notice is
 * best-effort, the invite stays pending for a resend, and since the URL is delivered
 * nowhere else, the failure cannot leak it. The token lives only inside the message, so
 * a failure logs the address and the relay's error, never the URL.
 *
 * <p>The relay call runs on the notifier's executor, not the request thread: a degraded
 * relay must not hold an HTTP worker for the full timeout per invite. The message is
 * built on the calling thread, which is the transaction's after-commit hook, so no
 * entity is touched once the transaction is gone.
 */
@Slf4j
public class SmtpWorkspaceInviteNotifier implements WorkspaceInviteNotifier {

    private final JavaMailSender mailSender;
    private final String from;
    private final Executor executor;

    public SmtpWorkspaceInviteNotifier(JavaMailSender mailSender, String from, Executor executor) {
        this.mailSender = mailSender;
        this.from = from;
        this.executor = executor;
    }

    @Override
    public boolean isDeliveryConfigured() {
        return true;
    }

    @Override
    public void inviteIssued(WorkspaceInvite invite, String invitationUrl) {
        MimeMessagePreparator message = message(invite, invitationUrl);
        String email = invite.getEmail();
        UUID workspaceId = invite.getWorkspace().getId();
        try {
            executor.execute(() -> send(message, email, workspaceId));
        } catch (RejectedExecutionException ex) {
            // The invite row is already committed and can be resent; dropping the notice
            // is better than failing a request that already succeeded.
            log.warn("Invitation email for {} in workspace {} was dropped: queue is full", email, workspaceId);
        }
    }

    private void send(MimeMessagePreparator message, String email, UUID workspaceId) {
        try {
            mailSender.send(message);
        } catch (MailException ex) {
            // The URL is in the body; log only who it was for and what the relay said.
            log.warn(
                    "Invitation email for {} in workspace {} could not be sent: {}",
                    email,
                    workspaceId,
                    ex.getMessage());
        }
    }

    /**
     * Fields are read here, on the calling thread: the notice runs after commit, and
     * keeping the preparator free of entity access leaves the async send nothing to
     * lazily load later.
     */
    private MimeMessagePreparator message(WorkspaceInvite invite, String invitationUrl) {
        String workspaceName = invite.getWorkspace().getName();
        String email = invite.getEmail();
        // Names stored before the API rejected control characters could otherwise reach
        // the Subject header: CR/LF there is header injection.
        String subject = "You have been invited to join "
                + workspaceName.replaceAll("\\p{Cntrl}+", " ").strip();
        String plainBody = """
                Hello,

                You have been invited to join %s on NextDocs.

                Accept the invitation: %s

                This link is personal to this address and works only once.
                """.formatted(workspaceName, invitationUrl);
        String htmlBody = """
                <p>Hello,</p>
                <p>You have been invited to join <strong>%s</strong> on NextDocs.</p>
                <p><a href="%s">Accept the invitation</a></p>
                <p>This link is personal to this address and works only once.</p>
                """.formatted(HtmlUtils.htmlEscape(workspaceName), invitationUrl);

        return mimeMessage -> {
            MimeMessageHelper helper = new MimeMessageHelper(mimeMessage, true, StandardCharsets.UTF_8.name());
            helper.setFrom(from);
            helper.setTo(email);
            helper.setSubject(subject);
            helper.setText(plainBody, htmlBody);
        };
    }
}
