package com.nextdocs.api.search.event;

import java.util.UUID;

/** A document title changed and its search row must follow. Published after commit. */
public record DocumentSearchTitleChangedEvent(UUID documentId) {}
