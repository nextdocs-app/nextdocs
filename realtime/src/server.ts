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
  SWEEP_INTERVAL_MS,
  ACTIVE_ROOM_WINDOW_MS,
  API_BASE_URL,
  YHUB_SERVICE_TOKEN,
} from './config.js';
import {
  verifyHs256Jwt,
  isServiceAuthorization,
  checkApiAccess,
  type UserAuthInfo,
} from './auth.js';
import {
  documentPermissions,
  adminDocumentPermissions,
  serviceOrgPermissions,
} from './permissions.js';
import { ActiveRoomTracker, startRoomSweep } from './sweep.js';
import { checkStore, jsonResponse } from './health.js';

/** Rooms this instance currently serves, refreshed by every authorize call. */
const activeRooms = new ActiveRoomTracker(ACTIVE_ROOM_WINDOW_MS);

type RecheckRequest = {
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

const authPlugin = createAuthPlugin<UserAuthInfo>({
  async authenticate(req) {
    const authHeader = req.getHeader('authorization');
    const queryToken = req.getQuery('token')?.trim();

    // The service identity is server-to-server only. A query token is a URL a
    // browser can be tricked into opening, so it is never accepted as the service
    // credential — even if it holds the right value.
    if (isServiceAuthorization(authHeader)) {
      return { userid: 'service', isService: true };
    }

    const headerToken = authHeader
      ? (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader).trim()
      : '';
    const token = headerToken || queryToken || '';

    if (!token) {
      return { userid: 'anonymous' };
    }

    const payload = verifyHs256Jwt(token, JWT_SECRET);
    if (!payload) {
      throw apiError(401, 'Invalid or expired token');
    }

    return { userid: payload.sub, token };
  },

  authorize: createAuthorize<UserAuthInfo>({
    async document({ org, docid, branch }, user) {
      if (user?.isService) {
        return adminDocumentPermissions;
      }

      if (org !== ORG || branch !== 'main' || !UUID_REGEX.test(docid)) {
        return null;
      }

      const access = await checkApiAccess(docid, user?.token);
      if (!access || !access.allowed || access.trashed) {
        return null;
      }

      activeRooms.touch(docid);
      return documentPermissions(access.accessLevel);
    },

    async org({ org }, user) {
      if (!user?.isService || org !== ORG) {
        return null;
      }
      return serviceOrgPermissions;
    },

    async global() {
      return {
        type: 'permissions:global:v1',
        endpoint: { health: '-r--', ping: '-r--' },
      };
    },
  }),
});

const customEndpoints = [
  /**
   * Batched recheck. Access changes inherit (a grant on an ancestor applies to
   * every descendant), so one edit can affect a whole subtree; one request per
   * document would turn that into a fan-out of HTTP calls from the API.
   */
  createApiEndpoint('recheck', {
    scope: 'org',
    post: {
      handler: async (req) => {
        const request = req as unknown as RecheckRequest;
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

        for (const docid of docids) {
          await request.yhub.recheckAuth({ org: request.org, docid, branch: 'main' }, { users });
        }

        return {
          status: 'ok',
          rechecked: docids.length,
        };
      },
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

/**
 * Tell the API that Yhub persisted new content for a document.
 *
 * Fires once per compaction that found new content, and the worker already
 * debounces compaction, so the rate is naturally bounded per document. The
 * route moves `updated_at` only: the projection is forbidden from touching
 * that column, because it is the sidebar sort key and a ten-second replica
 * would otherwise reorder the sidebar on its own.
 *
 * Deliberately not awaited by the worker event: a slow API must never hold a
 * compaction. A lost notification costs a stale sort position, not content.
 */
async function touchContentUpdated(docid: string): Promise<void> {
  try {
    const res = await fetch(
      `${API_BASE_URL}/api/v1/internal/realtime/content-updated?documentId=${encodeURIComponent(docid)}`,
      {
        method: 'POST',
        headers: { 'X-Yhub-Service': YHUB_SERVICE_TOKEN },
        signal: AbortSignal.timeout(3000),
      }
    );
    if (!res.ok) {
      console.warn(`Realtime content-updated failed for ${docid}: status ${res.status}`);
    }
  } catch (err) {
    console.warn(
      `Realtime content-updated failed for ${docid}:`,
      err instanceof Error ? err.message : err
    );
  }
}

// The return type is explicit: declaration emit cannot name the config generic that
// createYHub infers, and the entrypoint does not need the handle.
export async function createServer(): Promise<void> {
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
          if (docRef.org !== ORG || docRef.branch !== 'main' || !UUID_REGEX.test(docRef.docid)) {
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
    onError: (err, docid) => {
      console.warn(
        `Realtime access sweep failed for ${docid}:`,
        err instanceof Error ? err.message : err
      );
    },
  });
}
