import { API_BASE_URL, ORG, UUID_REGEX, YHUB_SERVICE_TOKEN } from './config.js';
import { extractDocumentText } from './search-text.js';
import { describeError } from './health.js';
import { log } from './logger.js';

/** The content-updated callback is limited to this org's main-branch documents. */
export function shouldNotifyContentUpdated(docRef: {
  org: string;
  docid: string;
  branch: string;
}): boolean {
  return docRef.org === ORG && docRef.branch === 'main' && UUID_REGEX.test(docRef.docid);
}

/** Notification attempts before the sort key and projection wait for the next edit. */
const ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type ContentUpdatedPayload = {
  documentId: string;
  text?: string;
  truncated?: boolean;
  producedAt?: string;
  /** True for a crawl-driven re-read, which must not move the sidebar sort key. */
  reindex?: boolean;
};

/**
 * Tell the API that Yhub persisted new content for a document.
 *
 * <p>Carries the extracted text when the compaction event handed us the post-GC update,
 * so the API can refresh the search projection in the same request that moves the
 * sidebar sort key. A document with no content produces `text: ""`, which is a
 * legitimate clear of the indexed body.
 *
 * <p>If extraction fails the call is still sent without text: the timestamp must move,
 * and sending empty text would erase a good projection entry. The API's reconcile job
 * retries from the Y.Doc. A reindex has no timestamp to move, so the same failure rejects
 * instead: the caller counts that document as failed rather than indexed.
 *
 * <p>Rejects only when `reindex` is true and the projection was not written. A live
 * compaction must never throw: it is deliberately not awaited by the worker event, since
 * a slow API must never hold a compaction. Transient failures retry with backoff; a
 * notification that still fails leaves only a stale projection, never lost content.
 *
 * @param producedAt when the content was read. A reindex passes the instant captured
 *     before its read, so a live compaction that landed while the read was in flight
 *     stays the newer write (the API orders both by this value).
 */
export async function notifyContentUpdated(
  docid: string,
  update?: Uint8Array | null,
  reindex = false,
  producedAt?: string
): Promise<void> {
  const payload: ContentUpdatedPayload = { documentId: docid };
  if (reindex) {
    payload.reindex = true;
  }

  if (update) {
    try {
      const extracted = extractDocumentText(update);
      payload.text = extracted.text;
      payload.truncated = extracted.truncated;
      payload.producedAt = producedAt ?? new Date().toISOString();
    } catch (err) {
      log.warn(`Realtime text extraction failed for ${docid} (${describeError(err)})`);
      // A reindex exists to repair the projection; without text there is nothing to write.
      if (reindex) {
        throw new Error(`Realtime text extraction failed for ${docid}`, { cause: err });
      }
    }
  }

  // A failed extraction on a live compaction still sends the timestamp-only body (the
  // sort key must move). A reindex must also send its flag even then: the API uses it to
  // skip the sort key, and losing it would restart the stale loop.
  const body = payload.text !== undefined || reindex ? JSON.stringify(payload) : undefined;

  const headers: Record<string, string> = { 'X-Yhub-Service': YHUB_SERVICE_TOKEN };
  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let retry = true;
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/v1/internal/realtime/content-updated?documentId=${encodeURIComponent(docid)}`,
        {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(3000),
        }
      );
      if (res.ok) {
        return;
      }
      // 4xx other than 429 is a contract error (a malformed id, a rejected credential):
      // retrying cannot succeed.
      if (res.status < 500 && res.status !== 429) {
        log.warn(`Realtime content-updated rejected for ${docid}: status ${res.status}`);
        retry = false;
      } else {
        log.warn(
          `Realtime content-updated attempt ${attempt}/${ATTEMPTS} for ${docid}: status ${res.status}`
        );
      }
    } catch (err) {
      log.warn(
        `Realtime content-updated attempt ${attempt}/${ATTEMPTS} for ${docid} (${describeError(err)})`
      );
    }

    if (!retry) {
      break;
    }
    if (attempt < ATTEMPTS) {
      await sleep(250 * 3 ** (attempt - 1));
    }
  }

  if (reindex) {
    // The batch answer must reflect reality: a document whose projection was never
    // written is a failure, not an indexed page.
    throw new Error(`Realtime content-updated failed for ${docid}`);
  }
}
