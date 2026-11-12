import { apiError } from '@y/hub';
import { INTERNAL_HTTP_URL, MAX_REINDEX_DOCS, UUID_REGEX, YHUB_SERVICE_TOKEN } from './config.js';
import { notifyContentUpdated } from './content-updated.js';
import { describeError } from './health.js';
import { readJsonBody, type JsonBodyRequest } from './json-body.js';
import { log } from './logger.js';

export type SearchReindexRequest = JsonBodyRequest & { org: string };

export type SearchReindexDeps = {
  /** The document's current Yjs update, or null when no room exists yet. */
  readUpdate(docid: string): Promise<Uint8Array | null>;
  /** Extracts and forwards the text. Reused so the API sees one payload contract. */
  index(docid: string, update: Uint8Array | null): Promise<void>;
};

/** One document read must not hold the batch; the API retries the batch next pass. */
const READ_TIMEOUT_MS = 10_000;

/**
 * Re-extracts content for documents the API identified as missing or stale.
 *
 * <p>The API cannot parse Yjs, so the crawl only picks ids from Postgres and this service
 * turns each Y.Doc into text. Sequential on purpose: a backfill must not compete with
 * live compactions for compute. A single unreadable document is counted and skipped so
 * the ones behind it still progress.
 */
export async function handleSearchReindex(
  req: SearchReindexRequest,
  deps: SearchReindexDeps = defaultDeps
): Promise<{ status: string; indexed: number; failed: number }> {
  const body = await readJsonBody(req);
  const docids = Array.isArray(body?.docids) ? body.docids : [];

  if (docids.length === 0 || docids.length > MAX_REINDEX_DOCS) {
    throw apiError(400, `docids must contain between 1 and ${MAX_REINDEX_DOCS} entries`);
  }
  for (const docid of docids) {
    if (typeof docid !== 'string' || !UUID_REGEX.test(docid)) {
      throw apiError(400, 'docids must be document UUIDs');
    }
  }

  let indexed = 0;
  let failed = 0;
  for (const docid of docids) {
    try {
      const update = await deps.readUpdate(docid);
      // An absent room is empty content, not a failure to read: indexing it records the
      // projection and lets the crawl move past the document instead of retrying forever.
      await deps.index(docid, update ?? new Uint8Array(0));
      indexed++;
    } catch (err) {
      failed++;
      log.warn(`Realtime reindex failed for ${docid} (${describeError(err)})`);
    }
  }

  return { status: 'ok', indexed, failed };
}

const defaultDeps: SearchReindexDeps = {
  readUpdate: readDocumentUpdate,
  index: (docid, update) => notifyContentUpdated(docid, update, true),
};

/**
 * Reads the current content through the same Yhub route the API uses. It is a loopback
 * call by default ({@link INTERNAL_HTTP_URL}), but the route already enforces the service
 * credential and returns the exact `{doc: <base64 update>}` contract, so no internal Yhub
 * API is relied on here.
 */
async function readDocumentUpdate(docid: string): Promise<Uint8Array | null> {
  const res = await fetch(`${INTERNAL_HTTP_URL}/api/ydoc/v1/nextdocs/${docid}`, {
    headers: {
      Authorization: `Bearer ${YHUB_SERVICE_TOKEN}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
  });

  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`content read failed with status ${res.status}`);
  }

  const body = (await res.json()) as { doc?: string | null };
  // A room that has never been written answers with an empty update, which is real
  // content (empty), not a failure to read.
  if (!body?.doc) {
    return new Uint8Array(0);
  }
  return new Uint8Array(Buffer.from(body.doc, 'base64'));
}
