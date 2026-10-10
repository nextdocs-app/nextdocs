import { getApiBaseUrl } from '@/lib/api-url.util';
import { canonicalStoredAttachmentUrl } from '@/lib/attachment.util';
import { parseApiEnvelope } from '@/services/api-envelope';

export interface UploadedAttachment {
  id: string;
  documentId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  url: string;
  createdAt: string;
}

interface ApiAttachmentUrl {
  url: string;
  expiresAt: string | number;
}

export class AttachmentServiceApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AttachmentServiceApiError';
    this.status = status;
  }
}

/**
 * A stored value that is not an attachment path and not an http(s) embed. Kept
 * distinct from transport failures (offline/CORS/abort surface as TypeError) so a
 * dropped connection is never reported as an unsupported URL.
 */
export class UnsupportedUrlError extends Error {
  constructor(message = 'Only http(s) URLs can be displayed in a document.') {
    super(message);
    this.name = 'UnsupportedUrlError';
  }
}

/** Refresh signed URLs this long before they expire so a render never races the deadline. */
const RESOLVED_URL_SAFETY_MARGIN_MS = 60_000;
/** Retry window after a failed resolution so a broken attachment cannot hammer the endpoint. */
const FAILED_RESOLUTION_RETRY_MS = 30_000;
/**
 * How long a URL whose expiry the server did not parse stays reusable. It is deliberately
 * longer than the safety margin so the entry is actually served before it is re-minted.
 */
const UNPARSEABLE_EXPIRY_CACHE_MS = 5 * 60_000;
/** Upper bound on cached URLs per session so a document with many files cannot grow unbounded. */
const MAX_CACHED_URLS = 200;
/**
 * External blocks may point at embeds over http(s). Every other scheme (javascript:, data:,
 * vbscript:, ...) is inert here: a URL planted in shared Yjs state must never reach the DOM.
 */
const EXTERNAL_URL_PATTERN = /^https?:\/\//i;

interface CachedResolvedUrl {
  url: string;
  expiresAtMs: number;
}

interface CachedResolutionFailure {
  error: unknown;
  retryAtMs: number;
}

export function parseSignedUrlExpiry(value: string | number | null | undefined): number {
  if (typeof value === 'number') {
    return value * 1000;
  }
  if (value == null) {
    return 0;
  }
  const numeric = Number(value);
  if (value.trim() !== '' && Number.isFinite(numeric)) {
    return numeric * 1000;
  }
  const parsed = Date.parse(value);
  // 0 marks an unparseable expiry; callers must not treat it as a fresh timestamp.
  return Number.isNaN(parsed) ? 0 : parsed;
}

class AttachmentService {
  /**
   * Caches are keyed by identity + attachment, never by attachment alone: a URL minted
   * for one token must not be served to another, even inside one render pass. Every
   * map (positive, negative, in-flight) shares the same key so they cannot disagree.
   */
  // Cleared on any auth change; late resolutions must not write after an epoch bump.
  private readonly resolvedUrlCache = new Map<string, CachedResolvedUrl>();
  private readonly failedResolutions = new Map<string, CachedResolutionFailure>();
  private readonly inFlightResolutions = new Map<string, Promise<string>>();
  private authEpoch = 0;

  public async uploadAttachment(
    documentId: string,
    file: File,
    accessToken: string
  ): Promise<UploadedAttachment> {
    const formData = new FormData();
    formData.append('file', file);

    // No Content-Type header: the browser must set the multipart boundary itself.
    const response = await fetch(
      `${getApiBaseUrl()}/api/v1/documents/${encodeURIComponent(documentId)}/attachments`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
      }
    );

    return this.readEnvelope<UploadedAttachment>(response);
  }

  /**
   * Turns the stored attachment path into an absolute, short-lived signed URL.
   * External embeds pass through only when they use http(s); resolutions are cached,
   * failures are briefly negative-cached, and concurrent calls are de-duplicated so N
   * blocks cost one request each.
   */
  public async resolveAttachmentUrl(
    storedUrl: string,
    accessToken: string | null
  ): Promise<string> {
    // A signed URL can arrive in its relative or absolute form (older blocks, or a link that
    // was pasted before the stored-path convention); canonicalize before deciding whether
    // this is an attachment at all, so the http(s) allowlist only sees real embeds.
    const canonicalUrl = canonicalStoredAttachmentUrl(storedUrl);
    if (canonicalUrl === null) {
      if (!EXTERNAL_URL_PATTERN.test(storedUrl)) {
        throw new UnsupportedUrlError();
      }
      return storedUrl;
    }

    const cacheKey = `${accessToken ?? ''}\n${canonicalUrl}`;
    const cached = this.resolvedUrlCache.get(cacheKey);
    if (cached && cached.expiresAtMs - RESOLVED_URL_SAFETY_MARGIN_MS > Date.now()) {
      return cached.url;
    }

    const failed = this.failedResolutions.get(cacheKey);
    if (failed && failed.retryAtMs > Date.now()) {
      throw failed.error;
    }

    const inFlight = this.inFlightResolutions.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const epoch = this.authEpoch;
    const resolution = this.fetchSignedUrl(canonicalUrl, accessToken, epoch, cacheKey)
      .catch((error: unknown) => {
        if (epoch === this.authEpoch) {
          this.setBounded(this.failedResolutions, cacheKey, {
            error,
            retryAtMs: Date.now() + FAILED_RESOLUTION_RETRY_MS,
          });
        }
        throw error;
      })
      .finally(() => {
        if (this.inFlightResolutions.get(cacheKey) === resolution) {
          this.inFlightResolutions.delete(cacheKey);
        }
      });
    this.inFlightResolutions.set(cacheKey, resolution);
    return resolution;
  }

  public resetAttachmentUrlCache(): void {
    this.authEpoch += 1;
    this.resolvedUrlCache.clear();
    this.failedResolutions.clear();
    this.inFlightResolutions.clear();
  }

  private async fetchSignedUrl(
    storedUrl: string,
    accessToken: string | null,
    epoch: number,
    cacheKey: string
  ): Promise<string> {
    const headers: Record<string, string> = {};
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    const response = await fetch(`${getApiBaseUrl()}${storedUrl}/url`, {
      method: 'GET',
      credentials: 'include',
      headers,
    });

    const body = await this.readEnvelope<ApiAttachmentUrl>(response);
    // The mint endpoint must return a usable link: an empty or non-http(s) value would
    // otherwise resolve to the API root and be cached as the file.
    const rawUrl = typeof body.url === 'string' ? body.url.trim() : '';
    if (!rawUrl || (!EXTERNAL_URL_PATTERN.test(rawUrl) && !rawUrl.startsWith('/'))) {
      throw new AttachmentServiceApiError(
        'The server returned a file URL that cannot be displayed safely.',
        response.status
      );
    }
    // The API returns a relative URL unless a public base URL is configured for a CDN.
    const absoluteUrl = EXTERNAL_URL_PATTERN.test(rawUrl) ? rawUrl : `${getApiBaseUrl()}${rawUrl}`;
    // A logout/login/refresh-failure may have bumped the epoch while this request was in
    // flight; a stale identity's URL must never repopulate the next session's cache.
    if (epoch === this.authEpoch) {
      const expiresAtMs = parseSignedUrlExpiry(body.expiresAt);
      if (expiresAtMs === 0) {
        // An unparseable expiry is cached briefly instead of costing one mint per render.
        this.setBounded(this.resolvedUrlCache, cacheKey, {
          url: absoluteUrl,
          expiresAtMs: Date.now() + UNPARSEABLE_EXPIRY_CACHE_MS,
        });
      } else if (expiresAtMs > Date.now()) {
        this.setBounded(this.resolvedUrlCache, cacheKey, { url: absoluteUrl, expiresAtMs });
      }
      // An expiry the server already reports as past is deliberately not cached: each
      // render would otherwise replay a dead link for the whole grace window and suppress
      // the re-mint that heals it.
    }
    return absoluteUrl;
  }

  private setBounded<K, V>(map: Map<K, V>, key: K, value: V): void {
    if (map.size >= MAX_CACHED_URLS && !map.has(key)) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) {
        map.delete(oldest);
      }
    }
    map.set(key, value);
  }

  private async readEnvelope<T>(response: Response): Promise<T> {
    const body = await parseApiEnvelope<T>(response);

    if (!response.ok || !body?.success || body.data == null) {
      throw new AttachmentServiceApiError(
        body?.message || body?.error || `Request failed with status ${response.status}.`,
        response.status
      );
    }

    return body.data;
  }
}

export const attachmentService = new AttachmentService();
