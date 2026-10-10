package com.nextdocs.api.attachment.storage;

import org.springframework.core.io.Resource;

/**
 * A readable attachment file plus the metadata the download endpoint needs.
 *
 * @param resource         streamable content (a {@code FileSystemResource} for local storage)
 * @param sizeBytes        exact content length
 * @param rangesSupported  whether HTTP range requests can be served from this resource.
 *                         Local storage always supports it; the {@code false} branch in the
 *                         download endpoint is the seam for a future object-store backend.
 */
public record StoredAttachment(Resource resource, long sizeBytes, boolean rangesSupported) {}
