package com.nextdocs.api.realtime.event;

import java.util.List;
import java.util.UUID;

/** Emitted after a hard delete commits, so open sockets on the removed subtree close. */
public record DocumentPurgedEvent(List<UUID> documentIds) {}
