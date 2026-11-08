package com.nextdocs.api.realtime.event;

import java.util.UUID;

/**
 * The space's audience or lifecycle changed (archive, restore, member add/update/remove).
 * Every page filed into the space inherits the change, so the notifier expands the space
 * into its page roots and their subtrees.
 */
public record SpaceAccessChangedEvent(UUID spaceId) {}
