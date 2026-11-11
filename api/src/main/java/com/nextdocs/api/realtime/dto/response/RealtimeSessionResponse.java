package com.nextdocs.api.realtime.dto.response;

import com.nextdocs.api.document.entity.DocumentAccessLevel;

/**
 * The realtime connection details for one document.
 *
 * <p>No {@code readOnly} or {@code expiresAt}: the server resolves access from the
 * database on every authorize and every recheck, so a client-side copy of the level would
 * only go stale. The token itself is the session — it expires on its own.
 */
public record RealtimeSessionResponse(String wsUrl, String documentId, DocumentAccessLevel accessLevel) {}
