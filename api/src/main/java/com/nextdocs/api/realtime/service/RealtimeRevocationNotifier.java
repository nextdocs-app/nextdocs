package com.nextdocs.api.realtime.service;

import com.nextdocs.api.realtime.client.YhubClient;
import com.nextdocs.api.realtime.event.DocumentAccessChangedEvent;
import com.nextdocs.api.realtime.event.DocumentPurgedEvent;
import com.nextdocs.api.realtime.event.SpaceAccessChangedEvent;
import java.util.List;
import java.util.UUID;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Turns committed access changes into Yhub rechecks.
 *
 * <p>Every listener is best-effort on purpose: the write has already committed, so a
 * failure here must not turn a successful request into a 500. The realtime service sweeps
 * every live room on an interval, so a lost notification delays a socket closing instead
 * of preventing it.
 */
@Slf4j
@Component
public class RealtimeRevocationNotifier {

    private final YhubClient yhubClient;
    private final RealtimeAccessScopeResolver scopeResolver;

    public RealtimeRevocationNotifier(YhubClient yhubClient, RealtimeAccessScopeResolver scopeResolver) {
        this.yhubClient = yhubClient;
        this.scopeResolver = scopeResolver;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onAccessChanged(DocumentAccessChangedEvent event) {
        try {
            List<UUID> documentIds =
                    event.subtree() ? scopeResolver.forDocument(event.documentId()) : List.of(event.documentId());
            yhubClient.recheck(documentIds, event.affectedUsers());
        } catch (RuntimeException e) {
            log.warn("Could not notify Yhub about an access change on {}: {}", event.documentId(), e.getMessage());
        }
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onSpaceAccessChanged(SpaceAccessChangedEvent event) {
        try {
            yhubClient.recheck(scopeResolver.forSpace(event.spaceId()), List.of());
        } catch (RuntimeException e) {
            log.warn("Could not notify Yhub about a space access change on {}: {}", event.spaceId(), e.getMessage());
        }
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onPurged(DocumentPurgedEvent event) {
        // The rows are gone, so every authorize answer is now a denial. Rechecking closes
        // the open sockets; the outbox job removes the content itself.
        try {
            yhubClient.recheck(event.documentIds(), List.of());
        } catch (RuntimeException e) {
            log.warn(
                    "Could not notify Yhub about {} purged document(s): {}",
                    event.documentIds().size(),
                    e.getMessage());
        }
    }
}
