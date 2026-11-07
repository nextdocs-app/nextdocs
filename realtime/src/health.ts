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
 * One readiness check.
 *
 * The error never leaves the process: the readiness route is unauthenticated,
 * and a postgres or redis client will happily put its connection string —
 * password included — in the message it raises.
 */
export async function checkStore(
  name: string,
  probe: () => PromiseLike<unknown>,
  timeoutMs: number = READINESS_TIMEOUT_MS
): Promise<[string, StoreState]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      probe(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer in ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    return [name, 'ok'];
  } catch (err) {
    console.warn(
      `Realtime readiness: ${name} is unreachable:`,
      err instanceof Error ? err.message : err
    );
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
