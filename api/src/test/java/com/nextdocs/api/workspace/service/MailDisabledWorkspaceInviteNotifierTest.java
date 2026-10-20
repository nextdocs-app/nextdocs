package com.nextdocs.api.workspace.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.entity.WorkspaceInvite;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.Test;

class MailDisabledWorkspaceInviteNotifierTest {

    private final MailDisabledWorkspaceInviteNotifier notifier = new MailDisabledWorkspaceInviteNotifier();

    @Test
    void isDeliveryConfigured_isFalse() {
        assertThat(notifier.isDeliveryConfigured()).isFalse();
    }

    @Test
    void inviteIssued_failsLoudlyIfTheServiceEverAsks() {
        // Unreachable through WorkspaceInviteService, which checks the capability first;
        // a silent success here would leave a token nobody can deliver.
        assertThatThrownBy(() -> notifier.inviteIssued(invite(), "http://localhost:3000/join#token=x"))
                .isInstanceOf(IllegalStateException.class);
    }

    private WorkspaceInvite invite() {
        return WorkspaceInvite.builder()
                .workspace(Workspace.builder().name("NextDocs").build())
                .email("jane@example.com")
                .role(WorkspaceRole.MEMBER)
                .tokenHash("hash")
                .expiresAt(OffsetDateTime.now().plusDays(7))
                .build();
    }
}
