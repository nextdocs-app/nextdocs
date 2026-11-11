import { createYHub, createAuthPlugin, createAuthorize, createApiEndpoint, apiError } from '@y/hub';
import {
  ORG,
  PORT,
  REDIS_URL,
  POSTGRES_URL,
  JWT_SECRET,
  CORS_ORIGINS,
  UUID_REGEX,
  MAX_DOC_SIZE_BYTES,
  MAX_RECHECK_DOCS,
  RECHECK_CONCURRENCY,
  SWEEP_INTERVAL_MS,
  API_BASE_URL,
  YHUB_SERVICE_TOKEN,
} from './config.js';
import {
  verifyAccessToken,
  isServiceAuthorization,
  checkApiAccess,
  type UserAuthInfo,
} from './auth.js';
import { buildAuthCallbacks } from './authorize.js';
import { handleAnchorCreate, handleAnchorDelete } from './anchor.js';
import { ActiveRoomTracker, RecheckGate, startRoomSweep } from './sweep.js';
import { checkStore, describeError, jsonResponse } from './health.js';
import { log } from './logger.js';

/** Rooms this instance currently serves, refreshed by every authorize call. */
const activeRooms = new ActiveRoomTracker();

/**
 * One in-flight registry for the sweep and the batch endpoint. A batch that lands
 * while a sweep is rechecking the same room joins that call instead of issuing a
 * duplicate `recheckAuth`; a different user filter is a different question and runs
 * on its own.
 */
const recheckGate = new RecheckGate(RECHECK_CONCURRENCY);

export type RecheckRequest = {
  org: string;
  yhub: {
    recheckAuth(
      docRef: { org: string; docid: string; branch: string },
      opts: { users?: string[] | null }
    ): Promise<void>;
  };
  bytes(): Promise<Uint8Array>;
};

type HealthRequest = {
  yhub: {
    stream: { redis: { ping(): Promise<string> } };
    persistence: { sql: (strings: TemplateStringsArray) => Promise<unknown> };
  };
};

const authCallbacks = buildAuthCallbacks({
  org: ORG,
  uuidRegex: UUID_REGEX,
  jwtSecret: JWT_SECRET,
  isService: isServiceAuthorization,
  verifyToken: verifyAccessToken,
  checkAccess: checkApiAccess,
  onAuthorized: (docid) => activeRooms.touch(docid),
});

const authPlugin = createAuthPlugin<UserAuthInfo>({
  authenticate: authCallbacks.authenticate,
  authorize: createAuthorize<UserAuthInfo>(authCallbacks.authorize),
});

const customEndpoints = [
  /**
   * Comment anchors. COMMENT users cannot write the Y.Doc, so the browser sends
   * the selection as Yjs relative positions and this service inserts the
   * BlockNote comment mark through `agentTask`. The thread id is checked against
   * the API first; DELETE only clears a mark after the API reports the thread
   * gone, so the `d` bit on COMMENT cannot strip a live discussion.
   */
  createApiEndpoint('anchor', {
    scope: 'document',
    post: {
      handler: handleAnchorCreate,
    },
    delete: {
      handler: handleAnchorDelete,
    },
  }),
  /**
   * Batched recheck. Access changes inherit (a grant on an ancestor applies to
   * every descendant), so one edit can affect a whole subtree; one request per
   * document would turn that into a fan-out of HTTP calls from the API.
   */
  createApiEndpoint('recheck', {
    scope: 'org',
    post: {
      handler: handleRecheck,
    },
  }),
  /**
   * Liveness. It answers, therefore the http channel and the event loop are
   * alive — which is all a liveness probe should ever conclude. Touching Redis
   * or Postgres here would restart a server that holds perfectly good
   * websocket connections every time a store blinks.
   */
  createApiEndpoint('ping', {
    scope: 'global',
    get: {
      handler: () => jsonResponse(200, { status: 'pong' }),
    },
  }),
  /**
   * Readiness. The two stores this service cannot serve a document without,
   * asked in parallel so a probe never pays one store's latency on top of the
   * other's. A 503 takes this pod out of the endpoints and leaves its siblings
   * serving; it must not be used as a liveness probe.
   */
  createApiEndpoint('health', {
    scope: 'global',
    get: {
      handler: async (req) => {
        const internals = (req as unknown as HealthRequest).yhub;
        const checks = Object.fromEntries(
          await Promise.all([
            checkStore('postgres', () => internals.persistence.sql`SELECT 1`),
            checkStore('redis', async () => {
              const reply = await internals.stream.redis.ping();
              if (reply !== 'PONG') {
                throw new Error('unexpected ping reply');
              }
            }),
          ])
        );
        const ready = Object.values(checks).every((state) => state === 'ok');
        return jsonResponse(ready ? 200 : 503, {
          status: ready ? 'ready' : 'unready',
          checks,
        });
      },
    },
  }),
];

/**
 * Validates and runs a batched recheck. Exported so the request contract can be tested
 * without a live Yhub: the batch must be bounded, every id a UUID, and one wedged room
 * must not stop the rooms behind it.
 */
export async function handleRecheck(req: unknown): Promise<{ status: string; rechecked: number }> {
  const request = req as RecheckRequest;
  const body = await readJsonBody(request);
  const docids = Array.isArray(body?.docids) ? body.docids : [];
  // Yhub treats `users: []` as "match no connection" and null as "match all".
  // An empty list must not turn a recheck into a silent no-op.
  const users = Array.isArray(body?.users) && body.users.length > 0 ? body.users : null;

  if (docids.length === 0 || docids.length > MAX_RECHECK_DOCS) {
    throw apiError(400, `docids must contain between 1 and ${MAX_RECHECK_DOCS} entries`);
  }

  for (const docid of docids) {
    if (typeof docid !== 'string' || !UUID_REGEX.test(docid)) {
      throw apiError(400, 'docids must be document UUIDs');
    }
  }

  // The user list narrows a recheck, so a malformed entry would silently make
  // the whole request re-check nobody. Reject it instead.
  for (const userid of users ?? []) {
    if (typeof userid !== 'string' || !UUID_REGEX.test(userid)) {
      throw apiError(400, 'users must be user UUIDs');
    }
  }

  const failed: string[] = [];
  // Bounded parallel rather than one room at a time: a subtree move can enqueue
  // thousands of documents, and a single wedged room must not make the request time
  // out for every room behind it. The sweep is the safety net for any room that
  // still fails.
  await recheckGate.run(
    docids,
    (docid) => request.yhub.recheckAuth({ org: request.org, docid, branch: 'main' }, { users }),
    {
      users,
      timeoutMs: RECHECK_TIMEOUT_MS,
      onResult: (docid, outcome) => {
        if (outcome === 'failed') {
          failed.push(docid);
        }
      },
    }
  );

  if (failed.length > 0) {
    throw apiError(503, `Failed to re-check ${failed.length} of ${docids.length} document(s)`);
  }

  return {
    status: 'ok',
    rechecked: docids.length,
  };
}

async function readJsonBody(req: RecheckRequest): Promise<Record<string, unknown> | null> {
  try {
    const raw = await req.bytes();
    if (!raw || raw.length === 0) {
      return null;
    }
    const parsed = JSON.parse(new TextDecoder().decode(raw));
    return parsed != null && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Upper bound for one room's recheck before the batch moves on. */
const RECHECK_TIMEOUT_MS = 10_000;

/** The content-updated callback is limited to this org's main-branch documents. */
export function shouldNotifyContentUpdated(docRef: {
  org: string;
  docid: string;
  branch: string;
}): boolean {
  return docRef.org === ORG && docRef.branch === 'main' && UUID_REGEX.test(docRef.docid);
}

/** Notification attempts before the sort key is left stale until the next edit. */
const CONTENT_UPDATED_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Tell the API that Yhub persisted new content for a document.
 *
 * Fires once per compaction that found new content, and the worker already
 * debounces compaction, so the rate is naturally bounded per document. The
 * route moves `updated_at` only: the content already lives in Yhub and is never
 * copied into Postgres, but the timestamp is the sidebar sort key and the API
 * owns it.
 *
 * Ordering: `@y/hub` fires `docUpdate` just before it stores the update, so this
 * notification can reach the API ahead of durable storage. It only moves a sort
 * key, so the one-compaction lead is harmless.
 *
 * Deliberately not awaited by the worker event: a slow API must never hold a
 * compaction. Transient failures are retried with backoff rather than logged
 * and forgotten; a notification that still fails leaves only a stale sort
 * position - the next edit re-sends it - never lost content.
 */
export async function touchContentUpdated(docid: string): Promise<void> {
  for (let attempt = 1; attempt <= CONTENT_UPDATED_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/v1/internal/realtime/content-updated?documentId=${encodeURIComponent(docid)}`,
        {
          method: 'POST',
          headers: { 'X-Yhub-Service': YHUB_SERVICE_TOKEN },
          signal: AbortSignal.timeout(3000),
        }
      );
      if (res.ok) {
        return;
      }
      // 4xx other than 429 is a contract error (a malformed id, a rejected
      // credential): retrying cannot succeed.
      if (res.status < 500 && res.status !== 429) {
        log.warn(`Realtime content-updated rejected for ${docid}: status ${res.status}`);
        return;
      }
      log.warn(
        `Realtime content-updated attempt ${attempt}/${CONTENT_UPDATED_ATTEMPTS} for ${docid}: status ${res.status}`
      );
    } catch (err) {
      log.warn(
        `Realtime content-updated attempt ${attempt}/${CONTENT_UPDATED_ATTEMPTS} for ${docid} (${describeError(err)})`
      );
    }

    if (attempt < CONTENT_UPDATED_ATTEMPTS) {
      await sleep(250 * 3 ** (attempt - 1));
    }
  }
}

// The return type is explicit: declaration emit cannot name the config generic that
// createYHub infers. The entrypoint only needs the handle to drain on SIGTERM.
export interface RunningServer {
  destroy(options?: { drainMs?: number }): Promise<void> | void;
}

export async function createServer(): Promise<RunningServer> {
  const yhub = await createYHub({
    redis: {
      url: REDIS_URL,
      prefix: 'yhub',
      taskDebounce: 10000,
    },
    postgres: POSTGRES_URL,
    persistence: [],
    server: {
      port: PORT,
      apiPrefix: 'api',
      auth: authPlugin,
      api: customEndpoints,
      cors: { origin: CORS_ORIGINS },
      maxDocSize: MAX_DOC_SIZE_BYTES,
    },
    worker: {
      taskConcurrency: 5,
      events: {
        docUpdate: ({ docRef }: { docRef: { org: string; docid: string; branch: string } }) => {
          if (!shouldNotifyContentUpdated(docRef)) {
            return;
          }
          void touchContentUpdated(docRef.docid);
        },
      },
    },
  });

  startRoomSweep(yhub, activeRooms, {
    org: ORG,
    intervalMs: SWEEP_INTERVAL_MS,
    gate: recheckGate,
    onError: (err, docid) => {
      log.warn(`Realtime access sweep failed for ${docid} (${describeError(err)})`);
    },
  });

  return yhub;
}
