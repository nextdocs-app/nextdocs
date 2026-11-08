/**
 * Readiness helpers, kept out of `server.ts` so they can be tested without a
 * Yhub instance.
 *
 * Two probes, two questions:
 *
 *   `/api/ping/v1`   is this process answering at all? It touches nothing —
 *                    restarting a server over a store it cannot reach would
 *                    drop the websockets it is serving perfectly well.
 *   `/api/health/v1` can this process serve a document? It asks the two stores
 *                    this service cannot work without.
 */

/** Time a readiness probe gives a store before reporting it unreachable. */
export const READINESS_TIMEOUT_MS = 2000;

export type StoreState = 'ok' | 'unreachable';

/**
 * A short, non-sensitive description for a log line.
 *
 * An error message can carry a connection string, password included: a Redis or
 * Postgres client raises one when a connection fails. The readiness route already
 * keeps errors out of its response, and log output leaves the process through a
 * different boundary, so logs get the failure class (name and code) only.
 */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    return code ? `${err.name}: ${code}` : err.name;
  }
  return typeof err;
}

/**
 * The probe each store currently has outstanding, keyed by store name.
 *
 * A readiness probe answering late is worse than one answering slow: a Redis or
 * Postgres client that never answers would otherwise get a fresh command per
 * scrape, and a store that is merely slow would accumulate one socket write per
 * probe. One operation per store is in flight at a time; a timed-out call leaves
 * it tracked until it settles, so the next scrape waits on the same operation
 * instead of stacking another.
 */
const inFlightProbes = new Map<string, Promise<StoreState>>();

function runProbe(name: string, probe: () => PromiseLike<unknown>): Promise<StoreState> {
  return Promise.resolve()
    .then(probe)
    .then((): StoreState => 'ok')
    .catch((err): StoreState => {
      // The message never leaves the process: the readiness route is unauthenticated,
      // and a client will happily put its connection string - password included -
      // in the message it raises. Logs get the failure class only.
      console.warn(`Realtime readiness: ${name} is unreachable (${describeError(err)})`);
      return 'unreachable';
    });
}

/**
 * One readiness check with a response budget.
 *
 * The budget bounds how long the route waits, not the store operation: the probe
 * keeps running (and stays tracked) until it settles, and the next call reuses it.
 */
export async function checkStore(
  name: string,
  probe: () => PromiseLike<unknown>,
  timeoutMs: number = READINESS_TIMEOUT_MS
): Promise<[string, StoreState]> {
  let pending = inFlightProbes.get(name);
  if (!pending) {
    pending = runProbe(name, probe);
    inFlightProbes.set(name, pending);
    void pending.finally(() => {
      if (inFlightProbes.get(name) === pending) {
        inFlightProbes.delete(name);
      }
    });
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const state = await Promise.race([
      pending,
      new Promise<StoreState>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer in ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    return [name, state];
  } catch (err) {
    console.warn(`Realtime readiness: ${name} did not answer in time (${describeError(err)})`);
    return [name, 'unreachable'];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Explicit JSON: Yhub negotiates msgpack by default, which makes a plain
 * `curl` against a probe look like a corrupt response.
 */
export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
